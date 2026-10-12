-- Invariants enforced in the database, not only in the frontend.
-- A new source or verified offer invalidates the most recently approved dossier.
create or replace function public.forgecy_stale_dossier() returns trigger
language plpgsql security invoker as $$
declare cid uuid;
begin
 cid:=coalesce(new.client_id,old.client_id);
 update public.dossiers set status='stale' where client_id=cid and status='approved';
 return coalesce(new,old);
end $$;
create trigger source_invalidate after insert or update or delete on public.sources
 for each row execute function public.forgecy_stale_dossier();

create or replace function public.forgecy_offer_version() returns trigger
language plpgsql security invoker as $$
begin
 new.version:=old.version+1;
 new.updated_at:=now();
 return new;
end $$;
create trigger offer_version before update on public.offers
 for each row execute function public.forgecy_offer_version();
create or replace function public.forgecy_offer_invalidate() returns trigger
language plpgsql security invoker as $$
begin
 update public.dossiers set status='stale' where client_id=new.client_id and status='approved';
 update public.contents set status='stale'
  where client_id=new.client_id and offer_id=new.id and status in ('approved','review','draft');
 return new;
end $$;
create trigger offer_invalidate after insert or update on public.offers
 for each row execute function public.forgecy_offer_invalidate();

create or replace function public.forgecy_content_version() returns trigger
language plpgsql security invoker as $$
begin
 new.revision:=old.revision+1;
 new.updated_at:=now();
 return new;
end $$;
create trigger content_version before update on public.contents
 for each row execute function public.forgecy_content_version();
create or replace function public.forgecy_content_invalidate_variants() returns trigger
language plpgsql security invoker as $$
begin
 if old.title is distinct from new.title or old.caption is distinct from new.caption or old.slides is distinct from new.slides then
   update public.contents set status='stale'
    where parent_id=new.id and client_id=new.client_id and status<>'stale';
 end if;
 return new;
end $$;
create trigger content_invalidate_variants after update on public.contents
 for each row execute function public.forgecy_content_invalidate_variants();

-- Approval is atomic, idempotency-safe and tenant-safe. No partial campaigns.
create or replace function public.approve_forgecy_mission(p_client_id uuid,p_mission_id uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare m public.missions%rowtype;
        c jsonb;
        one_content jsonb;
        cid uuid;
        oid uuid;
        ov integer;
        doc_status text;
begin
 if not public.owns_forgecy_client(p_client_id) then raise exception 'Forbidden'; end if;
 select * into m from public.missions
   where id=p_mission_id and client_id=p_client_id for update;
 if not found or m.status<>'proposed' or m.proposed_action<>'create_campaign' then
   raise exception 'Proposta inesistente o gia elaborata';
 end if;
 select status into doc_status from public.dossiers
   where client_id=p_client_id order by version desc limit 1;
 if doc_status is distinct from 'approved' then
   raise exception 'Dossier da approvare prima della campagna';
 end if;
 c:=m.payload->'campaign';
 if c is null or jsonb_typeof(m.payload->'contents')<>'array' or jsonb_array_length(m.payload->'contents') not between 1 and 20
 then raise exception 'Payload della proposta non valido'; end if;
 oid:=nullif(c->>'offer_id','')::uuid;
 if oid is not null then
   select version into ov from public.offers where id=oid and client_id=p_client_id and status='verified';
   if not found then raise exception 'Offerta non verificata'; end if;
 end if;
 insert into public.campaigns(client_id,offer_id,title,objective,period,strategy,status)
 values(p_client_id,oid,left(c->>'title',180),left(c->>'objective',3000),
        left(c->>'period',80),coalesce(c->'strategy','{}'::jsonb),'draft')
 returning id into cid;
 for one_content in select value from jsonb_array_elements(m.payload->'contents') loop
   insert into public.contents(client_id,campaign_id,offer_id,title,caption,channel,format,slides,offer_version)
   values(p_client_id,cid,oid,left(one_content->>'title',240),
    left(coalesce(one_content->>'caption',''),12000),
    one_content->>'channel',one_content->>'format',
    coalesce(one_content->'slides','[]'::jsonb),ov);
 end loop;
 update public.missions set status='approved',updated_at=now() where id=m.id;
 insert into public.audit_events(client_id,actor_id,action,target_id,details)
 values(p_client_id,auth.uid(),'mission_approved',cid,jsonb_build_object('mission_id',m.id));
 return cid;
end $$;
revoke all on function public.approve_forgecy_mission(uuid,uuid) from public;
grant execute on function public.approve_forgecy_mission(uuid,uuid) to authenticated;

-- Prevent foreign relations pointing at a different tenant.
alter table public.sources add constraint sources_id_client_uq unique(id,client_id);
alter table public.offers add constraint offer_source_scoped foreign key (source_id,client_id) references public.sources(id,client_id);
alter table public.missions add constraint missions_id_client_uq unique(id,client_id);
alter table public.agent_events add constraint events_mission_scoped foreign key (mission_id,client_id) references public.missions(id,client_id);
alter table public.social_accounts add constraint social_account_id_client_uq unique(id,client_id);
alter table public.social_snapshots add constraint social_account_scoped foreign key (account_id,client_id) references public.social_accounts(id,client_id);

-- Generated media is stored privately; access to its path is client-scoped.
insert into storage.buckets(id,name,public,file_size_limit)
values('forgecy-assets','forgecy-assets',false,15728640)
on conflict(id) do nothing;
create policy forgecy_asset_upload on storage.objects for insert to authenticated
 with check (bucket_id='forgecy-assets' and public.owns_forgecy_client((split_part(name,'/',1))::uuid));
create policy forgecy_asset_read on storage.objects for select to authenticated
 using (bucket_id='forgecy-assets' and public.owns_forgecy_client((split_part(name,'/',1))::uuid));
create policy forgecy_asset_delete on storage.objects for delete to authenticated
 using (bucket_id='forgecy-assets' and public.owns_forgecy_client((split_part(name,'/',1))::uuid));

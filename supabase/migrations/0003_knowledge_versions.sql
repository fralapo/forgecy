-- Prevent approving analyses built against stale source/offer/profile revisions.
alter table public.clients add column knowledge_revision integer not null default 0;
alter table public.dossiers add column knowledge_revision integer not null default 0;
alter table public.sources add column updated_at timestamptz not null default now();

create or replace function public.forgecy_client_knowledge_edit() returns trigger
language plpgsql security invoker as $$
begin
 if old.name is distinct from new.name or old.industry is distinct from new.industry
 or old.website is distinct from new.website or old.profile is distinct from new.profile then
   new.knowledge_revision:=old.knowledge_revision+1;
 end if;
 new.updated_at:=now();
 return new;
end $$;
create trigger forgecy_client_knowledge before update on public.clients
 for each row execute function public.forgecy_client_knowledge_edit();

create or replace function public.forgecy_increment_knowledge() returns trigger
language plpgsql security invoker as $$
declare cid uuid;
begin
 cid:=coalesce(new.client_id,old.client_id);
 update public.clients set knowledge_revision=knowledge_revision+1 where id=cid;
 update public.dossiers set status='stale' where client_id=cid and status in ('draft','approved');
 if TG_TABLE_NAME='offers' then
   update public.contents set status='stale' where client_id=cid and offer_id=coalesce(new.id,old.id) and status<>'stale';
 end if;
 return coalesce(new,old);
end $$;
drop trigger source_invalidate on public.sources;
drop trigger offer_invalidate on public.offers;
create trigger source_change after insert or update or delete on public.sources
 for each row execute function public.forgecy_increment_knowledge();
create trigger offer_change after insert or update or delete on public.offers
 for each row execute function public.forgecy_increment_knowledge();

create or replace function public.forgecy_stale_on_profile() returns trigger
language plpgsql security invoker as $$
begin
 if old.knowledge_revision <> new.knowledge_revision then
   update public.dossiers set status='stale' where client_id=new.id and status in ('draft','approved');
 end if;
 return new;
end $$;
create trigger forgecy_client_stale after update on public.clients
 for each row execute function public.forgecy_stale_on_profile();

create or replace function public.approve_forgecy_dossier(p_client_id uuid,p_dossier_id uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare d public.dossiers%rowtype; rev integer;
begin
 if not public.owns_forgecy_client(p_client_id) then raise exception 'Forbidden'; end if;
 select knowledge_revision into rev from public.clients where id=p_client_id for update;
 select * into d from public.dossiers where id=p_dossier_id and client_id=p_client_id for update;
 if not found or d.status<>'draft' or d.knowledge_revision<>rev then
   raise exception 'Dossier non aggiornato: ricrea la bozza';
 end if;
 if exists (select 1 from public.dossiers where client_id=p_client_id and version>d.version) then
   raise exception 'Esiste una versione piu recente';
 end if;
 update public.dossiers set status='stale' where client_id=p_client_id and id<>p_dossier_id and status='approved';
 update public.dossiers set status='approved',approved_at=now() where id=p_dossier_id;
 insert into public.audit_events(client_id,actor_id,action,target_id) values(p_client_id,auth.uid(),'dossier_approved',p_dossier_id);
 return p_dossier_id;
end $$;
revoke all on function public.approve_forgecy_dossier(uuid,uuid) from public;
grant execute on function public.approve_forgecy_dossier(uuid,uuid) to authenticated;

-- Block mission approval if approved dossier does not match current knowledge version.
create or replace function public.approve_forgecy_mission(p_client_id uuid,p_mission_id uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare m public.missions%rowtype;
        c jsonb; piece jsonb; cid uuid; oid uuid; ov integer;
        doc_status text; doc_rev integer; knowledge_rev integer;
begin
 if not public.owns_forgecy_client(p_client_id) then raise exception 'Forbidden'; end if;
 select * into m from public.missions where id=p_mission_id and client_id=p_client_id for update;
 if not found or m.status<>'proposed' or m.proposed_action<>'create_campaign' then
   raise exception 'Proposta inesistente o gia elaborata'; end if;
 select knowledge_revision into knowledge_rev from public.clients where id=p_client_id for update;
 select status,knowledge_revision into doc_status,doc_rev from public.dossiers
   where client_id=p_client_id order by version desc limit 1;
 if doc_status is distinct from 'approved' or doc_rev<>knowledge_rev then
   raise exception 'Dossier aggiornato e approvato richiesto'; end if;
 c:=m.payload->'campaign';
 if c is null or jsonb_typeof(m.payload->'contents')<>'array'
    or jsonb_array_length(m.payload->'contents') not between 1 and 20
 then raise exception 'Proposta non valida'; end if;
 oid:=nullif(c->>'offer_id','')::uuid;
 if oid is not null then
   select version into ov from public.offers where id=oid and client_id=p_client_id and status='verified';
   if not found then raise exception 'Offerta non verificata'; end if;
 end if;
 insert into public.campaigns(client_id,offer_id,title,objective,period,strategy,status)
 values(p_client_id,oid,left(c->>'title',180),left(c->>'objective',3000),
    left(c->>'period',80),coalesce(c->'strategy','{}'::jsonb),'draft') returning id into cid;
 for piece in select value from jsonb_array_elements(m.payload->'contents') loop
   insert into public.contents(client_id,campaign_id,offer_id,title,caption,channel,format,slides,offer_version)
   values(p_client_id,cid,oid,left(piece->>'title',240),left(coalesce(piece->>'caption',''),12000),
    piece->>'channel',piece->>'format',coalesce(piece->'slides','[]'::jsonb),ov);
 end loop;
 update public.missions set status='approved',updated_at=now() where id=m.id;
 insert into public.audit_events(client_id,actor_id,action,target_id,details)
 values(p_client_id,auth.uid(),'mission_approved',cid,jsonb_build_object('mission_id',m.id));
 return cid;
end $$;
revoke all on function public.approve_forgecy_mission(uuid,uuid) from public;
grant execute on function public.approve_forgecy_mission(uuid,uuid) to authenticated;

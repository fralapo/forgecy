-- V13: approval safety for proposals reviewed by the specialist Brand Guard.
-- Human review is necessary; unresolved blocking issues must not be silently accepted.
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
 if jsonb_typeof(m.payload#>'{campaign,strategy,qa,blocking_issues}')='array'
    and jsonb_array_length(m.payload#>'{campaign,strategy,qa,blocking_issues}')>0 then
   raise exception 'La proposta contiene problemi bloccanti: correggi prima di approvare';
 end if;
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
   insert into public.contents(client_id,campaign_id,offer_id,title,caption,channel,format,slides,offer_version,editorial_brief)
   values(p_client_id,cid,oid,left(piece->>'title',240),left(coalesce(piece->>'caption',''),12000),
    piece->>'channel',piece->>'format',coalesce(piece->'slides','[]'::jsonb),ov,coalesce(piece->'editorial_brief','{}'::jsonb));
 end loop;
 update public.missions set status='approved',updated_at=now() where id=m.id;
 insert into public.audit_events(client_id,actor_id,action,target_id,details)
 values(p_client_id,auth.uid(),'mission_approved',cid,jsonb_build_object('mission_id',m.id));
 return cid;
end $$;
revoke all on function public.approve_forgecy_mission(uuid,uuid) from public;
grant execute on function public.approve_forgecy_mission(uuid,uuid) to authenticated;

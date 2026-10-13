-- Forgecy V19: fencing tokens prevent an expired worker from completing or failing
-- another worker's attempt. Forward-only: apply AFTER 0011_client_evidence_search.sql.
alter table public.ai_jobs add column if not exists lease_token uuid;

-- The browser may inspect job progress but must NEVER see the worker's lease token.
-- Table-level SELECT overrides column grants, so revoke it explicitly.
revoke select on public.ai_jobs from authenticated;
grant select (
  id,client_id,requested_by,kind,payload,status,result,error,attempts,
  max_attempts,run_after,locked_until,created_at,updated_at,finished_at
) on public.ai_jobs to authenticated;

-- In-flight jobs created before this migration have no fence. Requeue them,
-- retaining their previous attempt count, rather than accepting unfenced writes.
update public.ai_jobs
  set status=case when attempts<max_attempts then 'queued' else 'failed' end,
      run_after=now(),locked_until=null,lease_token=null,updated_at=now(),
      error='Riaccodato durante la migrazione delle lease AI',
      finished_at=case when attempts<max_attempts then null else now() end
where status='running';

create or replace function public.forgecy_claim_ai_job()
returns setof public.ai_jobs language plpgsql security invoker set search_path='public' as $$
begin
  update public.ai_jobs
    set status='failed',finished_at=now(),locked_until=null,lease_token=null,
        updated_at=now(),error='Il worker non ha completato il lavoro entro il limite'
  where status='running' and locked_until<=now() and attempts>=max_attempts;

  update public.ai_jobs
    set status='queued',run_after=now(),locked_until=null,lease_token=null,
        updated_at=now(),error='Tentativo interrotto: nuova esecuzione'
  where status='running' and locked_until<=now() and attempts<max_attempts;

  return query
  with candidate as (
    select j.id from public.ai_jobs j
    where j.status='queued' and j.run_after<=now()
    order by j.created_at,j.id
    for update skip locked limit 1
  )
  update public.ai_jobs j
     set status='running',attempts=j.attempts+1,
         lease_token=gen_random_uuid(),
         locked_until=now()+interval '150 seconds',
         updated_at=now(),error=null
  from candidate where j.id=candidate.id
  returning j.*;
end $$;
revoke all on function public.forgecy_claim_ai_job() from public,anon,authenticated;
grant execute on function public.forgecy_claim_ai_job() to service_role;

-- Heartbeats are conditional on the unexpired current token, never resurrecting
-- an expired worker. A 30s renewal cadence extends a 150s visibility window.
create or replace function public.forgecy_heartbeat_ai_job(
 p_job_id uuid,p_lease_token uuid
) returns boolean language sql security invoker set search_path='public' as $$
  with changed as (
    update public.ai_jobs
       set locked_until=now()+interval '150 seconds',updated_at=now()
     where id=p_job_id and status='running' and lease_token=p_lease_token
       and locked_until>now()
     returning id
  ) select exists(select 1 from changed);
$$;
revoke all on function public.forgecy_heartbeat_ai_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.forgecy_heartbeat_ai_job(uuid,uuid) to service_role;

create or replace function public.forgecy_complete_ai_job(
 p_job_id uuid,p_lease_token uuid,p_result jsonb
) returns boolean language sql security invoker set search_path='public' as $$
  with changed as (
    update public.ai_jobs
       set status='succeeded',result=coalesce(p_result,'{}'::jsonb),
           error=null,locked_until=null,lease_token=null,
           finished_at=now(),updated_at=now()
     where id=p_job_id and status='running' and lease_token=p_lease_token
       and locked_until>now()
       and octet_length(coalesce(p_result,'{}'::jsonb)::text)<=12000
     returning id
  ) select exists(select 1 from changed);
$$;
revoke all on function public.forgecy_complete_ai_job(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.forgecy_complete_ai_job(uuid,uuid,jsonb) to service_role;

create or replace function public.forgecy_fail_ai_job(
 p_job_id uuid,p_lease_token uuid,p_error text,
 p_retry boolean,p_run_after timestamptz
) returns boolean language sql security invoker set search_path='public' as $$
  with changed as (
    update public.ai_jobs
       set status=case when coalesce(p_retry,false) and attempts<max_attempts
                 then 'queued' else 'failed' end,
           run_after=case when coalesce(p_retry,false) and attempts<max_attempts
                  then greatest(now()+interval '1 second',
                        least(coalesce(p_run_after,now()),now()+interval '20 minutes'))
                  else run_after end,
           error=left(coalesce(p_error,'Errore sconosciuto'),400),
           locked_until=null,lease_token=null,
           finished_at=case when coalesce(p_retry,false) and attempts<max_attempts
                        then null else now() end,
           updated_at=now()
     where id=p_job_id and status='running' and lease_token=p_lease_token
       and locked_until>now()
     returning id
  ) select exists(select 1 from changed);
$$;
revoke all on function public.forgecy_fail_ai_job(uuid,uuid,text,boolean,timestamptz)
  from public,anon,authenticated;
grant execute on function public.forgecy_fail_ai_job(uuid,uuid,text,boolean,timestamptz)
  to service_role;

comment on column public.ai_jobs.lease_token is
  'Secret per-attempt fencing token. Never granted to authenticated frontend users.';

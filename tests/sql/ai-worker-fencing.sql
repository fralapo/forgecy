-- Regression tests for V19 lease fencing.
-- Run after all previous migrations and tests/sql/smoke.sql.
-- The service role (never an authenticated browser user) owns worker transitions.
set role service_role;

do $lease$
declare
  j public.ai_jobs%rowtype;
  old_token uuid;
  new_token uuid;
begin
  select * into j from public.ai_jobs where status='running' order by created_at limit 1;
  if j.id is null or j.lease_token is null then
    raise exception 'A claimed job must have a non-null lease token';
  end if;
  if not public.forgecy_heartbeat_ai_job(j.id,j.lease_token) then
    raise exception 'Current worker cannot renew its lease';
  end if;
  if public.forgecy_heartbeat_ai_job(j.id,gen_random_uuid()) then
    raise exception 'A different worker renewed someone else''s lease';
  end if;
  if public.forgecy_complete_ai_job(j.id,gen_random_uuid(),'{"should":"not-write"}'::jsonb) then
    raise exception 'Stale token completed a job';
  end if;
  if not public.forgecy_complete_ai_job(j.id,j.lease_token,'{"ok":true}'::jsonb) then
    raise exception 'Current worker cannot complete the job';
  end if;
  if public.forgecy_complete_ai_job(j.id,j.lease_token,'{}'::jsonb) then
    raise exception 'A completed job was completed twice';
  end if;
  if (select status from public.ai_jobs where id=j.id) <> 'succeeded' then
    raise exception 'Worker completion was not persisted';
  end if;

  -- Claim a crashed job with a new fencing token, preventing stale completion.
  old_token=gen_random_uuid();
  insert into public.ai_jobs(client_id,requested_by,kind,status,attempts,max_attempts,
                             lease_token,locked_until,created_at)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '11111111-1111-4111-8111-111111111111',
          'dossier','running',1,2,old_token,now()-interval '2 minutes',
          now()-interval '3 hours')
  returning id into j.id;
  select * into j from public.forgecy_claim_ai_job();
  if j.id is null or j.attempts <> 2 or j.lease_token = old_token
    or j.lease_token is null then
    raise exception 'Recovered job was not fenced and re-leased';
  end if;
  if public.forgecy_complete_ai_job(j.id,old_token,'{}'::jsonb) then
    raise exception 'Stale worker completed recovered job';
  end if;
  if public.forgecy_heartbeat_ai_job(j.id,old_token) then
    raise exception 'Stale worker extended recovered job';
  end if;
  if public.forgecy_fail_ai_job(j.id,old_token,'fake failure',true,now()+interval '2 minutes') then
    raise exception 'Stale worker failed recovered job';
  end if;
  if not public.forgecy_fail_ai_job(j.id,j.lease_token,'retry exhausted',true,now()) then
    raise exception 'Current worker could not mark exhausted job failed';
  end if;
  if (select status from public.ai_jobs where id=j.id) <> 'failed' then
    raise exception 'Maximum attempts did not end in failed state';
  end if;
end $lease$;

-- A normal signed-in user cannot call privileged worker operations.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $rights$
begin
  -- The authenticated workspace can read job status, but never its secret lease.
  perform id,status,attempts,run_after from public.ai_jobs
    where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  begin
    perform lease_token from public.ai_jobs limit 1;
    raise exception 'Browser could read the lease token';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.forgecy_complete_ai_job(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',gen_random_uuid(),'{}'::jsonb
    );
    raise exception 'Browser role could invoke privileged completion';
  exception when insufficient_privilege then null;
  end;
end $rights$;
reset role;

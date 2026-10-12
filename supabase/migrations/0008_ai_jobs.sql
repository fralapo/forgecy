-- Forgecy V15: durable per-client jobs with authenticated enqueue, bounded concurrency and worker leasing.
-- Apply AFTER 0007_source_intelligence.sql. Never expose the service-role key to the browser.
create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  kind text not null check(kind in ('dossier','mission')),
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 12000),
  status text not null default 'queued' check(status in ('queued','running','succeeded','failed','cancelled')),
  result jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0 check(attempts between 0 and 3),
  max_attempts integer not null default 2 check(max_attempts between 1 and 3),
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
-- Link generated artifacts back to their job so retry after a crash is idempotent.
alter table public.missions add column ai_job_id uuid unique references public.ai_jobs(id) on delete set null;
alter table public.dossiers add column ai_job_id uuid unique references public.ai_jobs(id) on delete set null;

grant select,insert,update,delete on public.ai_jobs to service_role;

create index ai_jobs_claim_idx on public.ai_jobs(status,run_after,created_at)
  where status in ('queued','running');
create index ai_jobs_client_idx on public.ai_jobs(client_id,created_at desc);
alter table public.ai_jobs enable row level security;
create policy ai_jobs_read on public.ai_jobs for select to authenticated
  using (public.owns_forgecy_client(client_id) and requested_by=auth.uid());
-- Access only via narrowly scoped SECURITY DEFINER functions or privileged cron worker.
revoke all on public.ai_jobs from anon,authenticated;
grant select on public.ai_jobs to authenticated;

create or replace function public.forgecy_enqueue_ai_job(
  p_client_id uuid,p_kind text,p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer
set search_path='' as $$
declare job_id uuid; client_owner uuid;
begin
  select owner_id into client_owner from public.clients
  where id=p_client_id;
  if client_owner is null or auth.uid() is null or client_owner<>auth.uid() then
    raise exception 'Cliente non autorizzato';
  end if;
  if p_kind not in ('dossier','mission') or p_payload is null
    or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>12000 then
    raise exception 'Lavoro non valido';
  end if;
  if p_kind='dossier' and p_payload<>'{}'::jsonb then
    raise exception 'Parametri dossier non validi';
  end if;
  if p_kind='mission' and (
     length(btrim(coalesce(p_payload->>'request',''))) not between 8 and 3000
     or length(coalesce(p_payload->>'period',''))>80
  ) then raise exception 'Parametri missione non validi'; end if;
  -- Database-level quota cannot be bypassed by calling Supabase REST directly.
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text,1024));
  if (select count(*) from public.ai_jobs
      where client_id=p_client_id and status in ('queued','running'))>=3
  then raise exception 'Tre lavori AI gia in corso per questo cliente'; end if;
  if (select count(*) from public.ai_jobs
      where client_id=p_client_id and created_at>now()-interval '24 hours')>=24
  then raise exception 'Limite giornaliero di lavori AI raggiunto'; end if;
  insert into public.ai_jobs(client_id,requested_by,kind,payload)
  values(p_client_id,auth.uid(),p_kind,p_payload)
  returning id into job_id;
  return job_id;
end $$;
revoke all on function public.forgecy_enqueue_ai_job(uuid,text,jsonb) from public,anon;
grant execute on function public.forgecy_enqueue_ai_job(uuid,text,jsonb) to authenticated;

create or replace function public.forgecy_cancel_ai_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  update public.ai_jobs set status='cancelled',finished_at=now(),updated_at=now()
    where id=p_job_id and status='queued' and requested_by=auth.uid()
      and public.owns_forgecy_client(client_id);
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.forgecy_cancel_ai_job(uuid) from public,anon;
grant execute on function public.forgecy_cancel_ai_job(uuid) to authenticated;

create or replace function public.forgecy_claim_ai_job()
returns setof public.ai_jobs language plpgsql security invoker set search_path='public' as $$
begin
  -- A crashed worker loses its lease. Mark permanently failed after max attempts.
  update public.ai_jobs set status='failed',finished_at=now(),locked_until=null,
      updated_at=now(),error='Il worker non ha completato il lavoro entro il limite'
    where status='running' and locked_until<now() and attempts>=max_attempts;
  update public.ai_jobs set status='queued',run_after=now(),locked_until=null,
      updated_at=now(),error='Tentativo interrotto: nuova esecuzione'
    where status='running' and locked_until<now() and attempts<max_attempts;

  return query
  with candidate as (
    select j.id from public.ai_jobs j
    where j.status='queued' and j.run_after<=now()
    order by j.created_at asc
    for update skip locked limit 1
  ) update public.ai_jobs j
    set status='running',attempts=j.attempts+1,
        locked_until=now()+interval '4 minutes',updated_at=now(),error=null
    from candidate where j.id=candidate.id returning j.*;
end $$;
revoke all on function public.forgecy_claim_ai_job() from public,anon,authenticated;
grant execute on function public.forgecy_claim_ai_job() to service_role;
-- Only the service-role worker may transition running jobs into final states.
revoke insert,update,delete on public.ai_jobs from authenticated;

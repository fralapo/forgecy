-- V24 — atomic cross-instance AI request budgets (not currency pricing).
-- Apply after 0015_ai_worker_fencing.sql. Reservations are intentionally not
-- refunded on provider failures: retries also consume capacity.
create table public.ai_request_reservations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('chat','adapt','dossier','strategy','mission','image')),
  weight smallint not null check(weight between 1 and 12),
  created_at timestamptz not null default now()
);
create index ai_request_client_kind_idx on public.ai_request_reservations(client_id,kind,created_at desc);
create index ai_request_owner_idx on public.ai_request_reservations(requested_by,created_at desc);
alter table public.ai_request_reservations enable row level security;
revoke all on public.ai_request_reservations from public,anon,authenticated;
grant select,insert,delete on public.ai_request_reservations to service_role;

create or replace function public.forgecy_reserve_ai_request(
  p_client_id uuid,p_kind text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_window integer;
  v_day integer;
  v_weight smallint;
  v_id uuid;
  v_now timestamptz := now();
begin
  select owner_id into v_owner from public.clients where id=p_client_id;
  if v_user is null or v_owner is null or v_user<>v_owner then
    raise exception 'Cliente non autorizzato' using errcode='42501';
  end if;
  -- Different limits for conversation, heavy multi-agent missions and images.
  case p_kind
    when 'chat'     then v_window:=20;v_day:=90;v_weight:=2;
    when 'adapt'    then v_window:=6;v_day:=24;v_weight:=4;
    when 'dossier'  then v_window:=3;v_day:=12;v_weight:=7;
    when 'strategy' then v_window:=3;v_day:=12;v_weight:=7;
    when 'mission'  then v_window:=3;v_day:=10;v_weight:=10;
    when 'image'    then v_window:=3;v_day:=12;v_weight:=12;
    else raise exception 'Tipo di richiesta AI non consentito' using errcode='22023';
  end case;
  -- Lock the owner, not just the client: creating additional clients cannot
  -- circumvent the workspace-wide daily allowance.
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text,24016));
  if (select count(*) from public.ai_request_reservations
      where client_id=p_client_id and kind=p_kind
      and created_at>v_now-interval '15 minutes')>=v_window then
    raise exception 'Limite frequenza AI raggiunto' using errcode='P0429';
  end if;
  if (select count(*) from public.ai_request_reservations
      where client_id=p_client_id and kind=p_kind
      and created_at>v_now-interval '24 hours')>=v_day then
    raise exception 'Limite giornaliero AI raggiunto' using errcode='P0429';
  end if;
  if coalesce((select sum(weight) from public.ai_request_reservations
      where requested_by=v_owner and created_at>v_now-interval '24 hours'),0)
      + v_weight > 240 then
    raise exception 'Limite giornaliero workspace AI raggiunto' using errcode='P0429';
  end if;
  insert into public.ai_request_reservations(client_id,requested_by,kind,weight)
  values(p_client_id,v_owner,p_kind,v_weight) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.forgecy_reserve_ai_request(uuid,text) from public,anon;
grant execute on function public.forgecy_reserve_ai_request(uuid,text) to authenticated;

-- Protect queued operations at the DATABASE ENTRYPOINT, including direct
-- PostgREST RPC clients that bypass the Next.js route.
create or replace function public.forgecy_enqueue_ai_job(
  p_client_id uuid,p_kind text,p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_owner uuid;
begin
  select owner_id into v_owner from public.clients where id=p_client_id;
  if auth.uid() is null or v_owner is null or v_owner<>auth.uid() then
    raise exception 'Cliente non autorizzato' using errcode='42501';
  end if;
  if p_kind not in ('dossier','mission','strategy') or p_payload is null
     or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>12000 then
    raise exception 'Lavoro non valido';
  end if;
  if p_kind in ('dossier','strategy') and p_payload<>'{}'::jsonb then
    raise exception 'Parametri dossier non validi';
  end if;
  if p_kind='mission' and (
    length(btrim(coalesce(p_payload->>'request',''))) not between 8 and 3000
    or length(coalesce(p_payload->>'period',''))>80
  ) then raise exception 'Parametri missione non validi';end if;

  -- Acquire the same owner lock as every other AI reservation BEFORE counting
  -- queued jobs; this avoids cross-client quota races and lock-order inversion.
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text,24016));
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text,1024));
  if (select count(*) from public.ai_jobs
      where client_id=p_client_id and status in ('queued','running'))>=3 then
    raise exception 'Tre lavori AI gia in corso per questo cliente';
  end if;
  if (select count(*) from public.ai_jobs
      where client_id=p_client_id and created_at>now()-interval '24 hours')>=24 then
    raise exception 'Limite giornaliero di lavori AI raggiunto';
  end if;
  perform public.forgecy_reserve_ai_request(p_client_id,p_kind);
  insert into public.ai_jobs(client_id,requested_by,kind,payload)
  values(p_client_id,auth.uid(),p_kind,p_payload) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.forgecy_enqueue_ai_job(uuid,text,jsonb) from public,anon;
grant execute on function public.forgecy_enqueue_ai_job(uuid,text,jsonb) to authenticated;

comment on table public.ai_request_reservations is
  'Atomic request-count/weighted allowances, NOT measured provider cost or currency billing.';

-- V25: provider-reported usage observations (NOT enforceable currency ceilings).
-- Use only service-role INSERT; owners may SELECT their own client records.
-- Never store prompts, responses, API keys or model-generated customer content.
create table public.ai_provider_usage (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.ai_jobs(id) on delete set null,
  provider text not null check (provider in ('openrouter','openai')),
  provider_request_id text check (provider_request_id is null or length(provider_request_id) <= 160),
  operation text not null check (operation in ('chat','adapt','dossier','strategy','mission','image')),
  model text not null check (length(model) between 1 and 180),
  prompt_tokens bigint check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens bigint check (completion_tokens is null or completion_tokens >= 0),
  total_tokens bigint check (total_tokens is null or total_tokens >= 0),
  reported_cost_usd numeric(16,9) check (reported_cost_usd is null or reported_cost_usd >= 0),
  usage_status text not null check (usage_status in ('reported','unavailable')),
  created_at timestamptz not null default now()
);
create index ai_provider_usage_client_recent_idx
  on public.ai_provider_usage(client_id,created_at desc);
create index ai_provider_usage_owner_recent_idx
  on public.ai_provider_usage(requested_by,created_at desc);
create unique index ai_provider_usage_external_id_unique
  on public.ai_provider_usage(provider,provider_request_id)
  where provider_request_id is not null;

alter table public.ai_provider_usage enable row level security;
revoke all on public.ai_provider_usage from public, anon, authenticated;
grant select on public.ai_provider_usage to authenticated;
grant select,insert on public.ai_provider_usage to service_role;
create policy ai_provider_usage_owner_select on public.ai_provider_usage
  for select to authenticated
  using (public.owns_forgecy_client(client_id) and auth.uid() = requested_by);

comment on table public.ai_provider_usage is
  'Provider-reported usage only. Missing cost stays NULL. Not a hard spend cap, billing or exhaustive reconciliation.';

-- SECURITY INVOKER preserves RLS. Counts with absent provider data remain explicit.
create or replace function public.forgecy_client_ai_usage_summary(
  p_client_id uuid, p_days integer default 30
) returns table (
  provider text,operation text,model text,
  calls bigint,token_reported_calls bigint,cost_reported_calls bigint,
  prompt_tokens numeric,completion_tokens numeric,reported_cost_usd numeric
) language sql stable security invoker set search_path='' as $$
  select u.provider,u.operation,u.model,
         count(*)::bigint,
         count(*) filter (where u.usage_status='reported')::bigint,
         count(*) filter (where u.reported_cost_usd is not null)::bigint,
         coalesce(sum(u.prompt_tokens),0)::numeric,
         coalesce(sum(u.completion_tokens),0)::numeric,
         sum(u.reported_cost_usd)::numeric
    from public.ai_provider_usage u
   where p_days between 1 and 90
     and u.client_id=p_client_id
     and auth.uid()=u.requested_by
     and u.created_at >= now()-make_interval(days=>p_days)
   group by u.provider,u.operation,u.model
   order by sum(u.reported_cost_usd) desc nulls last,u.provider,u.operation,u.model
   limit 100
$$;
revoke all on function public.forgecy_client_ai_usage_summary(uuid,integer) from public,anon;
grant execute on function public.forgecy_client_ai_usage_summary(uuid,integer) to authenticated;

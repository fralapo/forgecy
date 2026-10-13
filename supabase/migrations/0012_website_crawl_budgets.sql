-- Forgecy V19: cross-instance website acquisition budgets.
-- Apply AFTER 0011_client_evidence_search.sql.
-- Budget reservations are charged before any network fetch, including failed fetches.
-- This intentionally protects external sites and agency infrastructure from repeated retries.

create table public.website_crawl_requests (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 requested_by uuid not null references auth.users(id) on delete cascade,
 hostname text not null check (length(hostname) between 4 and 253),
 page_budget smallint not null check (page_budget between 1 and 6),
 requested_at timestamptz not null default now()
);
create index website_crawl_client_window_idx
 on public.website_crawl_requests(client_id,requested_at desc);
create index website_crawl_actor_window_idx
 on public.website_crawl_requests(requested_by,requested_at desc);

-- Reservation history must not be modified by a client via PostgREST.
alter table public.website_crawl_requests enable row level security;
revoke all on public.website_crawl_requests from public,anon,authenticated;
grant select,insert,update,delete on public.website_crawl_requests to service_role;

create function public.forgecy_reserve_website_crawl(
 p_client_id uuid,p_hostname text,p_page_budget integer
) returns uuid language plpgsql security definer set search_path='' as $$
declare
 client_owner uuid;
 reservation_id uuid;
 at_time timestamptz := now();
 client_recent_count integer;
 client_daily_pages bigint;
 owner_daily_pages bigint;
 owner_daily_requests bigint;
begin
 select owner_id into client_owner from public.clients where id=p_client_id;
 if client_owner is null or auth.uid() is null or client_owner<>auth.uid() then
  raise exception 'Cliente non autorizzato' using errcode='42501';
 end if;
 if p_hostname is null or length(p_hostname) not between 4 and 253
    or p_hostname !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    or position('.' in p_hostname)=0
    or position('..' in p_hostname)>0
    or p_page_budget is null or p_page_budget not between 1 and 6 then
   raise exception 'Richiesta di acquisizione non valida' using errcode='22023';
 end if;

 -- Serialize all reservations of the same owner across clients/instances.
 -- The lock lasts only for this database transaction, never during crawling.
 perform pg_advisory_xact_lock(hashtextextended(
   'forgecy:website-crawl:'||client_owner::text, 180124
 ));

 select count(*) into client_recent_count from public.website_crawl_requests
  where client_id=p_client_id and requested_at>at_time-interval '15 minutes';
 if client_recent_count>=2 then
  raise exception 'Attendi prima di avviare una nuova analisi del sito'
    using errcode='P0429';
 end if;

 select coalesce(sum(page_budget),0) into client_daily_pages
  from public.website_crawl_requests
  where client_id=p_client_id and requested_at>at_time-interval '24 hours';
 if client_daily_pages+p_page_budget>24 then
  raise exception 'Budget giornaliero del cliente esaurito'
    using errcode='P0429';
 end if;

 select count(*),coalesce(sum(page_budget),0)
  into owner_daily_requests,owner_daily_pages
  from public.website_crawl_requests
  where requested_by=client_owner and requested_at>at_time-interval '24 hours';
 if owner_daily_requests>=30 or owner_daily_pages+p_page_budget>144 then
  raise exception 'Budget giornaliero complessivo del workspace esaurito'
    using errcode='P0429';
 end if;

 insert into public.website_crawl_requests(client_id,requested_by,hostname,page_budget)
 values(p_client_id,client_owner,p_hostname,p_page_budget)
 returning id into reservation_id;
 return reservation_id;
end $$;
revoke all on function public.forgecy_reserve_website_crawl(uuid,text,integer)
 from public,anon;
grant execute on function public.forgecy_reserve_website_crawl(uuid,text,integer)
 to authenticated;

comment on table public.website_crawl_requests is
 'Per-account, per-client reserved crawl request budgets; short request metadata only, no scraped content or credentials.';
comment on function public.forgecy_reserve_website_crawl(uuid,text,integer) is
 'Authenticated atomic crawl budget; 2 requests/15 min/client, 24 pages/day/client, 30 requests or 144 pages/day/owner; P0429 on exhausted budget.';

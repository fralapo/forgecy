-- Queued workers have no user session JWT; do not weaken the session/RLS RPC.
-- Only a service-role caller may search for the explicit, verified job owner.
create or replace function public.forgecy_worker_search_client_sources(
  p_client_id uuid,
  p_requested_by uuid,
  p_query text,
  p_limit integer default 10
)
returns table (
  source_id uuid,
  source_title text,
  source_url text,
  chunk_ordinal integer,
  excerpt text,
  relevance real
)
language plpgsql stable security invoker set search_path='' as $$
declare
  terms tsquery;
begin
  if current_user <> 'service_role' then
    raise exception 'Worker non autorizzato' using errcode='42501';
  end if;
  if p_client_id is null or p_requested_by is null or not exists (
    select 1 from public.clients client
    where client.id=p_client_id and client.owner_id=p_requested_by
  ) then
    raise exception 'Proprietario del cliente non autorizzato' using errcode='42501';
  end if;
  if p_query is null or pg_catalog.length(pg_catalog.btrim(p_query)) not between 2 and 200
     or p_limit is null or p_limit not between 1 and 20 then
    raise exception 'Ricerca non valida' using errcode='22023';
  end if;

  terms := pg_catalog.websearch_to_tsquery('pg_catalog.simple'::regconfig,p_query);
  if pg_catalog.numnode(terms)=0 then return; end if;

  return query
  select c.source_id,s.title,s.url,c.ordinal,c.body,
         pg_catalog.ts_rank_cd(c.search_vector,terms)::real
  from public.source_chunks c
  join public.sources s on s.id=c.source_id and s.client_id=c.client_id
  where c.client_id=p_client_id and s.status='ready' and c.search_vector @@ terms
  order by 6 desc,c.source_id,c.ordinal
  limit p_limit;
end
$$;

revoke all on function public.forgecy_worker_search_client_sources(uuid,uuid,text,integer)
  from public,anon,authenticated;
grant execute on function public.forgecy_worker_search_client_sources(uuid,uuid,text,integer)
  to service_role;
-- Explicit minimum reads also make the worker contract testable on plain Postgres.
grant select (id,owner_id) on public.clients to service_role;
grant select (id,client_id,status,title,url) on public.sources to service_role;

comment on function public.forgecy_worker_search_client_sources(uuid,uuid,text,integer) is
  'Service-role-only excerpt retrieval with explicit client/job-owner verification. No user-session impersonation.';

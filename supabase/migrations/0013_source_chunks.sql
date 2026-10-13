-- Forgecy V20: client-scoped, searchable source excerpts.
-- This migration is schema-only. Backfill existing text separately in 0014.
-- The search index stores only bounded passages, never secrets or raw binary uploads.

create table public.source_chunks (
  id bigint generated always as identity primary key,
  client_id uuid not null,
  source_id uuid not null,
  ordinal integer not null check (ordinal between 0 and 79),
  body text not null check (length(body) between 1 and 1700),
  search_vector tsvector generated always as
    (pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,body)) stored,
  created_at timestamptz not null default now(),
  constraint source_chunks_source_fk
    foreign key (source_id,client_id)
    references public.sources(id,client_id) on delete cascade,
  constraint source_chunks_source_ordinal_uq unique (source_id,ordinal)
);

create index source_chunks_client_source_idx
  on public.source_chunks(client_id,source_id);
create index source_chunks_search_idx
  on public.source_chunks using gin(search_vector);

alter table public.source_chunks enable row level security;

create policy source_chunks_client_read on public.source_chunks
  for select to authenticated
  using (public.owns_forgecy_client(client_id));

-- The trigger owns all writes; logged-in users may query but not mutate the index.
revoke all on public.source_chunks from public,anon,authenticated;
grant select on public.source_chunks to authenticated;
grant select,insert,update,delete on public.source_chunks to service_role;

create or replace function public.forgecy_reindex_source_chunks()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  slot integer;
begin
  if TG_OP = 'DELETE' then
    delete from public.source_chunks where source_id=old.id;
    return old;
  end if;

  delete from public.source_chunks where source_id=new.id;

  if new.status = 'ready' and pg_catalog.length(pg_catalog.btrim(new.body)) > 0 then
    for slot in 0..least((pg_catalog.length(new.body)-1)/1500,79) loop
      insert into public.source_chunks(client_id,source_id,ordinal,body)
      values (
        new.client_id,new.id,slot,
        pg_catalog.substr(new.body,slot*1500+1,1700)
      );
    end loop;
  end if;

  return new;
end
$$;

revoke all on function public.forgecy_reindex_source_chunks() from public,anon,authenticated;

create trigger source_chunks_reindex
after insert or update of body,status,client_id or delete on public.sources
for each row execute function public.forgecy_reindex_source_chunks();

-- RPC uses the caller's role and RLS. There is no service-role access here.
create or replace function public.forgecy_search_client_sources(
  p_client_id uuid,
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
  if p_client_id is null or not public.owns_forgecy_client(p_client_id) then
    raise exception 'Cliente non autorizzato';
  end if;
  if p_query is null or pg_catalog.length(pg_catalog.btrim(p_query)) not between 2 and 200
     or p_limit is null or p_limit not between 1 and 20 then
    raise exception 'Ricerca non valida';
  end if;

  terms := pg_catalog.websearch_to_tsquery('pg_catalog.simple'::regconfig,p_query);
  if pg_catalog.numnode(terms) = 0 then return; end if;

  return query
  select
    c.source_id,s.title,s.url,c.ordinal,c.body,
    pg_catalog.ts_rank_cd(c.search_vector,terms)::real
  from public.source_chunks c
  join public.sources s
    on s.id=c.source_id and s.client_id=c.client_id
  where c.client_id=p_client_id
    and s.status='ready'
    and c.search_vector @@ terms
  order by 6 desc,c.source_id,c.ordinal
  limit p_limit;
end
$$;

revoke all on function public.forgecy_search_client_sources(uuid,text,integer)
  from public,anon;
grant execute on function public.forgecy_search_client_sources(uuid,text,integer)
  to authenticated;

comment on table public.source_chunks is
  'Automatically maintained excerpt index. Individual queries are scoped by client RLS.';

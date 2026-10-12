-- Forgecy V18: client-scoped full-text retrieval over human/website/document evidence.
-- Uses PostgreSQL 'simple' dictionary so the same index accepts mixed client languages.
create index if not exists forgecy_sources_fts_idx on public.sources
 using gin (to_tsvector('simple'::regconfig,
  coalesce(title,'') || ' ' || left(coalesce(body,''),20000)))
 where status='ready';

create or replace function public.forgecy_search_sources(
 p_client_id uuid,p_query text,p_limit integer default 8
) returns table(
 id uuid,title text,kind text,url text,excerpt text,relevance real,captured_at timestamptz
) language plpgsql stable security invoker set search_path='' as $$
declare q tsquery; maximum integer;
begin
 if auth.uid() is null or not public.owns_forgecy_client(p_client_id) then
  raise exception 'Cliente non autorizzato';
 end if;
 if p_query is null or length(btrim(p_query))<2 or length(p_query)>160 then
  raise exception 'Ricerca troppo breve o troppo lunga';
 end if;
 q:=websearch_to_tsquery('simple',p_query);
 if numnode(q)=0 then return; end if;
 maximum:=least(20,greatest(1,coalesce(p_limit,8)));
 return query
 select s.id,s.title,s.kind,s.url,
   left(ts_headline('simple',left(s.body,20000),q,
      'MaxFragments=2,MinWords=12,MaxWords=42,FragmentDelimiter= … '),1500) as excerpt,
   ts_rank(
     to_tsvector('simple',coalesce(s.title,'')||' '||left(s.body,20000)),q
   )::real as relevance,
   s.captured_at
 from public.sources s
 where s.client_id=p_client_id and s.status='ready'
   and to_tsvector('simple',coalesce(s.title,'')||' '||left(s.body,20000)) @@ q
 order by relevance desc,s.captured_at desc nulls last,s.id
 limit maximum;
end $$;
revoke all on function public.forgecy_search_sources(uuid,text,integer) from public,anon;
grant execute on function public.forgecy_search_sources(uuid,text,integer) to authenticated;

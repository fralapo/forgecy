-- Forgecy V17: one-time data backfill, deliberately separate from the schema migration.
-- On large installations run in planned batches with a migration window.
insert into public.source_chunks(client_id,source_id,ordinal,body)
select
  s.client_id,s.id,slot.n,
  pg_catalog.substring(s.body from slot.n*1500+1 for 1700)
from public.sources s
cross join lateral pg_catalog.generate_series(
  0,pg_catalog.least((pg_catalog.length(s.body)-1)/1500,79)
) as slot(n)
where s.status='ready' and pg_catalog.length(pg_catalog.btrim(s.body))>0
on conflict (source_id,ordinal) do update
set body=excluded.body,client_id=excluded.client_id;

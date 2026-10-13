-- V17 knowledge index and tenant isolation acceptance checks.
-- Runs AFTER smoke.sql. This intentionally tests both database and RPC security.
reset role;
revoke insert,update,delete on public.source_chunks from authenticated;
grant select on public.source_chunks to authenticated;

-- A distinct private source belongs to the other tenant.
insert into public.sources(
 id,client_id,kind,title,body,status
) values (
 '33333333-3333-4333-8333-333333333333',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'note','Client B proprietary data',
 'Only the other client may see the confidential expansion plan',
 'ready'
);

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);

do $knowledge$
declare
  note_id uuid;
  failed_as_expected boolean;
  c integer;
begin
  -- First tenant can retrieve its own already indexed source.
  select count(*) into c from public.forgecy_search_client_sources(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Confirmed',10
  );
  if c<1 then raise exception 'Own knowledge was not indexed';end if;

  -- RLS hides all second-tenant passages.
  if exists(
    select 1 from public.source_chunks
    where client_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) then raise exception 'Knowledge source index leaked another client';end if;

  failed_as_expected:=false;
  begin
    perform public.forgecy_search_client_sources(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','confidential',10
    );
  exception when others then
    if position('non autorizzato' in sqlerrm)>0 then
      failed_as_expected:=true;
    else raise;
    end if;
  end;
  if not failed_as_expected then
    raise exception 'Cross-client knowledge search unexpectedly succeeded';
  end if;

  failed_as_expected:=false;
  begin
    insert into public.source_chunks(client_id,source_id,ordinal,body)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      (select id from public.sources
       where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' limit 1),
      70,'Injected fake proof'
    );
  exception when insufficient_privilege then
    failed_as_expected:=true;
  end;
  if not failed_as_expected then raise exception 'Client could modify the knowledge index';end if;

  -- A source edit removes stale chunks and generates searchable replacements.
  select id into note_id from public.sources
    where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and title='Customer supplied' limit 1;
  if note_id is null then raise exception 'Fixture source unavailable';end if;
  update public.sources set body='Ricerche aggiornate: il cliente vende ceramiche artigianali'
    where id=note_id;

  if exists(select 1 from public.forgecy_search_client_sources(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Confirmed',10
  )) then raise exception 'Outdated source chunk remained searchable';end if;
  if not exists(select 1 from public.forgecy_search_client_sources(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ceramiche',10
  )) then raise exception 'Updated source missing from index';end if;

  update public.sources set status='pending' where id=note_id;
  if exists(select 1 from public.source_chunks where source_id=note_id)
    then raise exception 'Unprocessed source remained indexed';end if;

  update public.sources set status='ready' where id=note_id;
  if not exists(select 1 from public.source_chunks where source_id=note_id)
    then raise exception 'Reprocessed source was not reindexed';end if;
end
$knowledge$;

reset role;

-- Unicode-safe multi-chunk indexing: bounded size, overlap and exact query.
insert into public.sources(id,client_id,kind,title,body,status)
values(
 '44444444-4444-4444-8444-444444444444',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','note','Long evidence',
 repeat('Contesto ',200)||' separazioneCanali '||repeat('Matrice ',200),
 'ready'
);
do $knowledge$
begin
 if (select count(*) from public.source_chunks
     where source_id='44444444-4444-4444-8444-444444444444')<2 then
   raise exception 'Long source did not create multiple chunks';end if;
 if exists(select 1 from public.source_chunks
   where source_id='44444444-4444-4444-8444-444444444444'
   and length(body)>1700) then raise exception 'Chunk exceeds size limit';end if;
end
$knowledge$;

-- Disposable CI fixtures from smoke.sql and knowledge.sql only; never live data.
begin;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
do $worker_knowledge$
declare
  rejected boolean;
  count_a integer;
  count_b integer;
begin
  -- A worker has no auth.uid(), yet can retrieve its checked owner's evidence.
  select count(*) into count_a from public.forgecy_worker_search_client_sources(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111','ceramiche',4);
  select count(*) into count_b from public.forgecy_worker_search_client_sources(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222','confidential',4);
  if count_a<1 or count_b<1 then raise exception 'Worker cannot retrieve checked owner evidence';end if;

  rejected:=false;
  begin
    perform public.forgecy_worker_search_client_sources(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '11111111-1111-4111-8111-111111111111','confidential',4);
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'Mismatched worker owner retrieved another client';end if;

  rejected:=false;
  begin
    perform public.forgecy_worker_search_client_sources(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'ceramiche',4);
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'Worker search accepted a missing owner';end if;

  rejected:=false;
  begin
    perform public.forgecy_worker_search_client_sources(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',repeat('x',201),4);
  exception when invalid_parameter_value then rejected:=true;
  end;
  if not rejected then raise exception 'Worker query length is not bounded';end if;

  rejected:=false;
  begin
    perform public.forgecy_worker_search_client_sources(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111','ceramiche',21);
  exception when invalid_parameter_value then rejected:=true;
  end;
  if not rejected then raise exception 'Worker result limit is not bounded';end if;
end
$worker_knowledge$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $user_knowledge$
begin
  -- The regular RLS RPC still works for the owner.
  if not exists(select 1 from public.forgecy_search_client_sources(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ceramiche',4)) then
    raise exception 'User retrieval regressed';
  end if;
  begin
    perform public.forgecy_worker_search_client_sources(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111','ceramiche',4);
    raise exception 'Authenticated user invoked privileged worker search';
  exception when insufficient_privilege then null;
  end;
end
$user_knowledge$;
reset role;

set local role anon;
do $anonymous_knowledge$
begin
  begin
    perform public.forgecy_worker_search_client_sources(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111','ceramiche',4);
    raise exception 'Anonymous caller invoked privileged worker search';
  exception when insufficient_privilege then null;
  end;
end
$anonymous_knowledge$;
reset role;
rollback;

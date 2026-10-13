-- V25: provider ledger must remain immutable to app clients and hidden across tenants.
insert into public.ai_provider_usage(
  client_id,requested_by,provider,provider_request_id,operation,model,
  prompt_tokens,completion_tokens,total_tokens,reported_cost_usd,usage_status
) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111','openrouter','gen-ledger-A','chat','test/model',
  150,25,175,0.000123,'reported'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111','openai',null,'image','gpt-image-1',
  50,100,150,null,'reported'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '22222222-2222-4222-8222-222222222222','openrouter','gen-ledger-B','chat','test/model',
  7,9,16,0.005,'reported');

-- SQL uniqueness prevents replaying the same provider event as another client.
do $check$
begin
 begin
  insert into public.ai_provider_usage(client_id,requested_by,provider,provider_request_id,operation,model,usage_status)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',
          'openrouter','gen-ledger-A','chat','test/model','unavailable');
  raise exception 'Duplicate provider ID allowed';
 exception when unique_violation then null;end;
end $check$;

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $check$
declare v_count bigint;v_calls bigint;v_cost numeric;
begin
 select count(*) into v_count from public.ai_provider_usage;
 if v_count<>2 then raise exception 'RLS leaked foreign provider observations: %',v_count;end if;
 select sum(calls),sum(reported_cost_usd) into v_calls,v_cost
 from public.forgecy_client_ai_usage_summary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',30);
 if v_calls<>2 or v_cost<>0.000123 then
   raise exception 'Wrong usage aggregation: %, %',v_calls,v_cost;
 end if;
 select count(*) into v_count
 from public.forgecy_client_ai_usage_summary('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',30);
 if v_count<>0 then raise exception 'Cross-client summary leaked';end if;
 begin
  insert into public.ai_provider_usage(client_id,requested_by,provider,operation,model,usage_status)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '11111111-1111-4111-8111-111111111111','openrouter','chat','test/model','unavailable');
  raise exception 'Authenticated user forged a provider usage event';
 exception when insufficient_privilege then null;end;
 begin
  update public.ai_provider_usage set reported_cost_usd=0
  where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'Authenticated user modified provider usage';
 exception when insufficient_privilege then null;end;
end $check$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $check$
declare v_count bigint;
begin
 select count(*) into v_count from public.ai_provider_usage;
 if v_count<>1 then raise exception 'Second owner cannot read exactly their own events';end if;
end $check$;
reset role;

set role anon;
do $check$
begin
 begin
  perform count(*) from public.ai_provider_usage;
  raise exception 'Anonymous provider ledger leak';
 exception when insufficient_privilege then null;end;
 begin
  perform * from public.forgecy_client_ai_usage_summary('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',30);
  raise exception 'Anonymous summary RPC access';
 exception when insufficient_privilege then null;end;
end $check$;
reset role;

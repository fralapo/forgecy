-- V24: end-to-end database test of atomic AI reservations and RPC bypass prevention.
-- Runs AFTER smoke.sql, so its first user already has one queued dossier reservation.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $quota$
declare id uuid;
begin
  id:=public.forgecy_reserve_ai_request(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','chat'
  );
  if id is null then raise exception 'Reservation did not return an identifier';end if;
  begin
    perform public.forgecy_reserve_ai_request(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','chat'
    );
    raise exception 'Foreign client reservation bypassed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.forgecy_reserve_ai_request(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','surprise'
    );
    raise exception 'Unsupported operation accepted';
  exception when sqlstate '22023' then null; end;
  begin
    insert into public.ai_request_reservations(
      client_id,requested_by,kind,weight
    ) values(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111','chat',1
    );
    raise exception 'Direct reservation insertion bypassed';
  exception when insufficient_privilege then null; end;
  begin
    perform count(*) from public.ai_request_reservations;
    raise exception 'Budget event audit records leaked';
  exception when insufficient_privilege then null; end;
end $quota$;
reset role;

-- An unrelated owner has independent limits.
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select public.forgecy_reserve_ai_request('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','chat');
reset role;

-- Hit the per-client rolling quarter-hour limit. A chat was already reserved.
insert into public.ai_request_reservations(client_id,requested_by,kind,weight)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '11111111-1111-4111-8111-111111111111','chat',2
from generate_series(1,19);
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $quota$
begin
  begin
    perform public.forgecy_reserve_ai_request(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','chat'
    );
    raise exception '15-minute AI burst budget bypassed';
  exception when sqlstate 'P0429' then null; end;
end $quota$;
reset role;

-- Advance earlier chat reservations outside 15m, keep them inside 24h.
update public.ai_request_reservations
set created_at=now()-interval '1 hour'
where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and kind='chat';
insert into public.ai_request_reservations(client_id,requested_by,kind,weight,created_at)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '11111111-1111-4111-8111-111111111111','chat',2,
       now()-interval '1 hour'
from generate_series(1,70);

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $quota$
begin
  begin
    perform public.forgecy_reserve_ai_request(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','chat'
    );
    raise exception '24-hour AI request limit bypassed';
  exception when sqlstate 'P0429' then null; end;
end $quota$;
reset role;

-- The total owner-wide weighted budget includes activity on EVERY client.
-- 90 old chat reservations weigh 180; the queued dossier weighs 7.
-- Five image reservations on a second client weigh 60 -> total 247.
insert into public.ai_request_reservations(client_id,requested_by,kind,weight)
select '99999999-9999-4999-8999-999999999999',
       '11111111-1111-4111-8111-111111111111','image',12
from generate_series(1,5);
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $quota$
begin
  begin
    perform public.forgecy_reserve_ai_request(
      '88888888-8888-4888-8888-888888888888','adapt'
    );
    raise exception 'Owner-wide budget bypassed via another client';
  exception when sqlstate 'P0429' then null; end;
  begin
    perform public.forgecy_enqueue_ai_job(
      '88888888-8888-4888-8888-888888888888','dossier','{}'::jsonb
    );
    raise exception 'Direct enqueue bypassed owner-wide request budget';
  exception when sqlstate 'P0429' then null; end;
end $quota$;
reset role;

-- Other owners still have quota; old reservations outside 24h do not count.
insert into public.ai_request_reservations(client_id,requested_by,kind,weight,created_at)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       '22222222-2222-4222-8222-222222222222','image',12,
       now()-interval '48 hours'
from generate_series(1,25);
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select public.forgecy_reserve_ai_request('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','image');
reset role;

-- Function must not be callable by anonymous visitors.
set role anon;
do $quota$
begin
  begin
    perform public.forgecy_reserve_ai_request(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','chat'
    );
    raise exception 'Anonymous AI budget RPC callable';
  exception when insufficient_privilege then null; end;
end $quota$;
reset role;

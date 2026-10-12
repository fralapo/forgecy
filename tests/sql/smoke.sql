-- Migrations and tenant isolation assertions.
insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
-- The job table is deliberately read-only through PostgREST.
revoke insert,update,delete on public.ai_jobs from authenticated;
grant select on public.ai_jobs to authenticated;
revoke insert,update,delete on public.strategies from authenticated;
grant select on public.strategies to authenticated;
insert into public.clients(id,owner_id,name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Company A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','Company B');

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
begin
 if (select count(*) from public.clients) <> 1 then raise exception 'RLS leaked clients'; end if;
 if (select name from public.clients limit 1) <> 'Company A' then raise exception 'Wrong client visible'; end if;
end $$;

-- Cross-client writes must fail even when knowing the UUID.
do $$
begin
 begin
  insert into public.sources(client_id,kind,title) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','note','Stolen');
  raise exception 'Cross-tenant insert unexpectedly succeeded';
 exception when insufficient_privilege then null;
 end;
end $$;

-- Source edit invalidates the active dossier and increments revision.
insert into public.sources(client_id,kind,title,body,status)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','note','Customer supplied','Confirmed document','ready');
do $$
begin
 if (select knowledge_revision from public.clients where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1 then
  raise exception 'Knowledge revision did not increment'; end if;
end $$;

insert into public.dossiers(client_id,version,knowledge_revision,status,summary)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,1,'draft','Source review');
select public.approve_forgecy_dossier('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 (select id from public.dossiers where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
do $$
begin
 if (select status from public.dossiers where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'approved'
 then raise exception 'Dossier approval failed'; end if;
end $$;

insert into public.offers(client_id,kind,name,status)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','product','Ammorbidente','verified');
do $$
begin
 if (select status from public.dossiers where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'stale'
 then raise exception 'Offer creation must invalidate current dossier'; end if;
end $$;

-- An edit to an approved asset MUST reset its status; LinkedIn children go stale.
insert into public.dossiers(client_id,version,knowledge_revision,status,summary)
select id,2,knowledge_revision,'draft','Confirmed revised baseline'
from public.clients where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.approve_forgecy_dossier('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 (select id from public.dossiers where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and version=2));
insert into public.campaigns(id,client_id,title,objective,period)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','September','Promote verified offers','September');
insert into public.contents(id,client_id,campaign_id,channel,format,title,slides,status)
values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc','instagram','carousel','Original','[]'::jsonb,'approved'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc','linkedin','document','Adaptation','[]'::jsonb,'approved');
update public.contents set parent_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
 where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
update public.contents set title='Edited original' where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $test$
begin
 if (select status from public.contents where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd') <> 'draft'
 then raise exception 'Approval not reset on creative edit'; end if;
 if (select status from public.contents where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') <> 'stale'
 then raise exception 'Adaptation not invalidated'; end if;
end $test$;
-- Community evidence belongs to the active client only.
insert into public.community_signals(client_id,platform,kind,topic,excerpt,audience_need,source_url)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','instagram','question','Delicati','Come si usa sui tessuti delicati?','Chiarezza uso','https://example.com/post1');
do $editorial$
begin
 if (select count(*) from public.community_signals where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')<>1 then raise exception 'Signal was not persisted';end if;
 begin
  insert into public.community_signals(client_id,platform,kind,topic,excerpt)
  values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','instagram','comment','Other','Unrelated message');
  raise exception 'Cross client signal write unexpectedly succeeded';
 exception when insufficient_privilege then null;
 end;
end $editorial$;
-- Creative rationale must survive approval-safe content editing.
update public.contents set editorial_brief='{"hook":"What changes?","audience_need":"Explain fabric care","single_cta":""}'::jsonb
 where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
do $editorial$
begin
 if (select editorial_brief->>'hook' from public.contents where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd') <> 'What changes?'
 then raise exception 'Creative rationale missing'; end if;
end $editorial$;
-- Company strategies are separate, approval-bound objects based on the latest dossier.
reset role;
insert into public.strategies(client_id,dossier_id,version,status,knowledge_revision,blueprint)
select d.client_id,d.id,1,'draft',d.knowledge_revision,
 '{"title":"Approved baseline","positioning":"Evidence based","objectives":[]}'::jsonb
from public.dossiers d where d.client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and d.version=2;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.approve_forgecy_strategy('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 (select id from public.strategies where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
do $strategy$
begin
 if (select status from public.strategies where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'approved'
 then raise exception 'Strategy approval failed'; end if;
end $strategy$;
-- Brand Guard blockers must prevent final approval atomically.
insert into public.missions(id,client_id,status,request,proposed_action,payload)
values('ffffffff-ffff-4fff-8fff-ffffffffffff',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','proposed','Test quality gate',
 'create_campaign','{"campaign":{"title":"Blocked","objective":"Testing","period":"September","strategy":{"qa":{"blocking_issues":["Unsupported product claim"]}}},"contents":[{"channel":"instagram","format":"post","title":"Draft","caption":"Body","slides":[]}]}');
do $quality$
begin
 begin
  perform public.approve_forgecy_mission('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ffffffff-ffff-4fff-8fff-ffffffffffff');
 exception when others then
  if position('problemi bloccanti' in SQLERRM)=0 then raise; end if;
  return;
 end;
 raise exception 'Quality gate unexpectedly allowed blocked campaign';
end $quality$;
reset role;

-- AI job access: enqueue is scoped to the authenticated client and rate limited.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $jobs$
declare jid uuid; unavailable bool;
begin
 jid:=public.forgecy_enqueue_ai_job('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dossier','{}'::jsonb);
 if jid is null then raise exception 'Enqueue did not return an ID';end if;
 begin
   perform public.forgecy_enqueue_ai_job('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dossier','{}'::jsonb);
   raise exception 'Cross-client queue accepted';
 exception when others then
   if sqlerrm='Cross-client queue accepted' then raise; end if;
 end;
 begin
   update public.ai_jobs set status='succeeded' where id=jid;
   raise exception 'Client could mutate job directly';
 exception when insufficient_privilege then null;
 end;
 if (select count(*) from public.ai_jobs where client_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')<>1
 then raise exception 'Job not visible to its owner';end if;
end $jobs$;
reset role;
set role service_role;
do $jobs$
begin
 if (select count(*) from public.forgecy_claim_ai_job())<>1 then
   raise exception 'Worker could not claim one job';end if;
 if (select count(*) from public.ai_jobs where status='running' and attempts=1)<>1 then
   raise exception 'Atomic job claim failed';end if;
end $jobs$;
reset role;

-- Calendar is client-owned, attached contents must match the client, and planning is not publishing.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
insert into public.editorial_entries(client_id,created_by,content_id,channel,title,planned_at,status)
values (
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd','instagram','Editorial draft',
 now()+interval '2 days','planned'
);
do $cal$
begin
 if (select count(*) from public.editorial_entries)<>1 then
  raise exception 'Editorial calendar RLS did not return only owned records';
 end if;
 begin
  insert into public.editorial_entries(client_id,created_by,channel,title,planned_at)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111',
    'instagram','Cross-client entry',now());
  raise exception 'Cross-tenant calendar creation allowed';
 exception when insufficient_privilege then null;
 end;
 if exists (select 1 from public.editorial_entries where status='published') then
  raise exception 'Calendar must not imply automatic publishing';
 end if;
end $cal$;
reset role;

-- Multilingual client evidence search works only for the authenticated tenant.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $evidence$
declare total integer;
begin
 select count(*) into total from public.forgecy_search_sources(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Confirmed',8
 );
 if total<1 then raise exception 'Authorized evidence search did not return a source'; end if;
 begin
  perform public.forgecy_search_sources(
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Confirmed',8
  );
  raise exception 'Foreign client evidence search unexpectedly accepted';
 exception when others then
  if SQLERRM='Foreign client evidence search unexpectedly accepted' then raise;end if;
 end;
end $evidence$;
reset role;


-- Crawl budget acceptance: atomic, user-owned reservations, not bypassable via PostgREST.
-- These tests intentionally run after all migrations; they must FAIL before 0012 is implemented.
revoke all on public.website_crawl_requests from authenticated,anon;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $crawl$
declare a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
begin
  if public.forgecy_reserve_website_crawl(a,'example.com',6) is null then
    raise exception 'First crawl did not return an ID';
  end if;
  perform public.forgecy_reserve_website_crawl(a,'example.com',6);
  begin
    perform public.forgecy_reserve_website_crawl(a,'example.com',1);
    raise exception 'Client burst limit bypassed';
  exception when sqlstate 'P0429' then null;
  end;
  begin
    perform public.forgecy_reserve_website_crawl(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','other.example',1
    );
    raise exception 'Foreign client could reserve crawl';
  exception when others then
    if sqlerrm='Foreign client could reserve crawl' then raise; end if;
  end;
  begin
    insert into public.website_crawl_requests(client_id,requested_by,hostname,page_budget)
    values (a,'11111111-1111-4111-8111-111111111111','example.com',6);
    raise exception 'User bypassed quota by direct insert';
  exception when insufficient_privilege then null;
  end;
end $crawl$;
reset role;

-- A second client owned by the same account has its own burst quota.
insert into public.clients(id,owner_id,name) values
 ('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','Company C');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.forgecy_reserve_website_crawl('99999999-9999-4999-8999-999999999999','example.org',6);
reset role;

-- Reservations from an earlier 15-minute interval still count toward the rolling daily budget.
insert into public.website_crawl_requests(client_id,requested_by,hostname,page_budget,requested_at)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
       'example.com',6,now()-interval '1 hour'
from generate_series(1,2);
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $crawl$
begin
  begin
    perform public.forgecy_reserve_website_crawl(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','example.com',1
    );
    raise exception 'Client daily page limit bypassed';
  exception when sqlstate 'P0429' then null;
  end;
end $crawl$;
reset role;

-- The owner's total reserved traffic applies across all their clients.
insert into public.website_crawl_requests(client_id,requested_by,hostname,page_budget,requested_at)
select '99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111',
       'example.org',6,now()-interval '1 hour'
from generate_series(1,19);
insert into public.clients(id,owner_id,name) values
 ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','Company D');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $crawl$
begin
  begin
    perform public.forgecy_reserve_website_crawl(
      '88888888-8888-4888-8888-888888888888','example.net',1
    );
    raise exception 'Owner-wide daily budget bypassed';
  exception when sqlstate 'P0429' then null;
  end;
end $crawl$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select public.forgecy_reserve_website_crawl(
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','another-example.com',6
);
reset role;

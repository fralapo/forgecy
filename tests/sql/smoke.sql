-- Migrations and tenant isolation assertions.
insert into auth.users(id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
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
reset role;

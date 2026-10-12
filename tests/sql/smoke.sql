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
reset role;

-- Forgecy V11: per-client isolation with Supabase Auth and Postgres RLS.
create extension if not exists pgcrypto;

create table public.clients (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(name) between 1 and 160),
 industry text not null default '',
 website text,
 profile jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index clients_owner_idx on public.clients(owner_id);

create table public.sources (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 kind text not null check (kind in ('website','note','document','social')),
 title text not null,
 url text,
 body text not null default '',
 file_path text,
 status text not null default 'pending' check (status in ('pending','ready','error')),
 error text,
 captured_at timestamptz,
 created_at timestamptz not null default now()
);
create index sources_client_idx on public.sources(client_id);

create table public.offers (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 kind text not null check (kind in ('product','service')),
 name text not null check (length(name) between 1 and 180),
 description text not null default '',
 audience text not null default '',
 benefits text[] not null default '{}',
 price numeric(12,2),
 currency char(3) not null default 'EUR',
 cta text not null default '',
 source_id uuid references public.sources(id) on delete set null,
 status text not null default 'draft' check (status in ('draft','verified','archived')),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,client_id)
);
create index offers_client_idx on public.offers(client_id);

create table public.dossiers (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 version integer not null,
 status text not null default 'draft' check (status in ('draft','approved','stale')),
 findings jsonb not null default '[]'::jsonb,
 summary text not null default '',
 approved_at timestamptz,
 created_at timestamptz not null default now(),
 unique(client_id,version)
);
create index dossiers_client_idx on public.dossiers(client_id,version desc);

create table public.campaigns (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 offer_id uuid,
 title text not null,
 objective text not null,
 period text not null,
 strategy jsonb not null default '{}'::jsonb,
 status text not null default 'draft' check (status in ('draft','active','completed','archived')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,client_id),
 foreign key (offer_id,client_id) references public.offers(id,client_id)
);
create index campaigns_client_idx on public.campaigns(client_id);

create table public.contents (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 campaign_id uuid not null,
 offer_id uuid,
 parent_id uuid,
 channel text not null check (channel in ('instagram','linkedin')),
 format text not null check (format in ('post','carousel','document')),
 title text not null,
 caption text not null default '',
 slides jsonb not null default '[]'::jsonb,
 status text not null default 'draft' check (status in ('draft','review','approved','stale')),
 offer_version integer,
 revision integer not null default 1,
 source_revision integer,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,client_id),
 foreign key (campaign_id,client_id) references public.campaigns(id,client_id),
 foreign key (offer_id,client_id) references public.offers(id,client_id),
 foreign key (parent_id,client_id) references public.contents(id,client_id)
);
create index contents_campaign_idx on public.contents(campaign_id);

create table public.messages (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 role text not null check (role in ('user','leader')),
 body text not null,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index messages_client_idx on public.messages(client_id,created_at);

create table public.missions (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 status text not null default 'running' check (status in ('running','proposed','approved','rejected','failed')),
 request text not null,
 proposed_action text,
 payload jsonb not null default '{}'::jsonb,
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index missions_client_idx on public.missions(client_id,created_at desc);

create table public.agent_events (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 mission_id uuid not null references public.missions(id) on delete cascade,
 agent text not null,
 recipient text not null,
 summary text not null,
 result jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index agent_events_mission_idx on public.agent_events(mission_id,created_at);

create table public.social_accounts (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 platform text not null check(platform='instagram'),
 remote_id text not null,
 username text not null default '',
 token_ciphertext text not null,
 token_expires_at timestamptz,
 created_at timestamptz not null default now(),
 unique(client_id,platform,remote_id)
);
create table public.social_snapshots (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 account_id uuid not null references public.social_accounts(id) on delete cascade,
 data jsonb not null,
 period text not null,
 collected_at timestamptz not null default now()
);
create index social_snapshots_client_idx on public.social_snapshots(client_id,collected_at desc);

create table public.audit_events (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 actor_id uuid not null references auth.users(id),
 action text not null,
 target_id uuid,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

alter table public.clients enable row level security;
create policy clients_owner on public.clients for all to authenticated
 using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create or replace function public.owns_forgecy_client(cid uuid) returns boolean
 language sql stable security definer set search_path = ''
 as $$ select exists(select 1 from public.clients c where c.id=cid and c.owner_id=auth.uid()) $$;
revoke all on function public.owns_forgecy_client(uuid) from public;
grant execute on function public.owns_forgecy_client(uuid) to authenticated;

do $$ declare t text;
begin
 foreach t in array array['sources','offers','dossiers','campaigns','contents','messages','missions','agent_events','social_accounts','social_snapshots','audit_events'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy %I on public.%I for all to authenticated using (public.owns_forgecy_client(client_id)) with check (public.owns_forgecy_client(client_id))',t || '_owner',t);
 end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit)
values('forgecy-sources','forgecy-sources',false,10485760)
on conflict (id) do nothing;
create policy forgecy_upload on storage.objects for insert to authenticated
 with check (bucket_id='forgecy-sources' and public.owns_forgecy_client((split_part(name,'/',1))::uuid));
create policy forgecy_read on storage.objects for select to authenticated
 using (bucket_id='forgecy-sources' and public.owns_forgecy_client((split_part(name,'/',1))::uuid));
create policy forgecy_delete on storage.objects for delete to authenticated
 using (bucket_id='forgecy-sources' and public.owns_forgecy_client((split_part(name,'/',1))::uuid));

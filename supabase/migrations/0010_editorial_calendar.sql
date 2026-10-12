-- Forgecy V18: a client-scoped editorial calendar. Planning is not automated publishing.
create table public.editorial_entries(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 content_id uuid,
 channel text not null check(channel in ('instagram','linkedin','facebook','website','email')),
 title text not null check(length(title) between 1 and 240),
 notes text not null default '' check(length(notes)<=4000),
 status text not null default 'idea' check(status in ('idea','planned','ready','completed','cancelled')),
 planned_at timestamptz not null,
 timezone text not null default 'Europe/Rome' check(length(timezone) between 3 and 80),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,client_id),
 foreign key(content_id,client_id) references public.contents(id,client_id) on delete set null (content_id)
);
create index editorial_entries_client_time_idx on public.editorial_entries(client_id,planned_at);
alter table public.editorial_entries enable row level security;
create policy editorial_entries_owner on public.editorial_entries for all to authenticated
 using(public.owns_forgecy_client(client_id))
 with check(public.owns_forgecy_client(client_id) and created_by=auth.uid());
create or replace function public.forgecy_calendar_update() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 new.updated_at:=now();
 if new.client_id is distinct from old.client_id
    or new.created_by is distinct from old.created_by then
    raise exception 'Proprietario del calendario immutabile';
 end if;
 return new;
end $$;
create trigger forgecy_calendar_updated before update on public.editorial_entries
 for each row execute function public.forgecy_calendar_update();
comment on table public.editorial_entries is
 'An editorial plan. Entries in planned/ready status are NOT auto-published.';

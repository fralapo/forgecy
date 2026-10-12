-- Minimal auth/storage schemas to exercise Supabase-compatible migrations in vanilla PostgreSQL CI.
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema storage;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
  'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
create table storage.buckets (
 id text primary key,
 name text not null,
 public boolean not null default false,
 file_size_limit bigint
);
create table storage.objects (
 id uuid primary key default gen_random_uuid(),
 bucket_id text references storage.buckets(id),
 name text not null
);
grant usage on schema auth,storage,public to authenticated;
grant usage on schema auth,storage,public to service_role;
grant execute on function auth.uid() to authenticated;

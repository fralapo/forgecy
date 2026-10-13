-- Per-user model choices. Secrets and provider credentials are never stored here.
create table public.user_ai_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  text_model text check (text_model is null or length(text_model) between 1 and 180),
  image_model text check (image_model is null or length(image_model) between 1 and 180),
  updated_at timestamptz not null default now()
);

alter table public.user_ai_preferences enable row level security;
revoke all on public.user_ai_preferences from public, anon, authenticated;
grant select, insert, update on public.user_ai_preferences to authenticated;
create policy user_ai_preferences_owner_all on public.user_ai_preferences
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_ai_preferences is
  'Per-user OpenRouter model IDs only; no credentials, prompts or generated content.';

-- Per-user AI model settings must follow the Supabase auth user across devices.
insert into auth.users(id) values
 ('33333333-3333-4333-8333-333333333333'),
 ('44444444-4444-4444-8444-444444444444');

set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
insert into public.user_ai_preferences(user_id,text_model,image_model)
values ('33333333-3333-4333-8333-333333333333','openai/gpt-4.1-mini','openai/gpt-image-1');
do $owner_a$
declare row_count bigint;
begin
  select count(*) into row_count from public.user_ai_preferences;
  if row_count<>1 then raise exception 'Owner A cannot read its own preferences'; end if;
  update public.user_ai_preferences set text_model='anthropic/claude-sonnet-4'
   where user_id='33333333-3333-4333-8333-333333333333';
  if not found then raise exception 'Owner A cannot update its preferences'; end if;
end $owner_a$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
do $owner_b$
declare row_count bigint;
begin
  select count(*) into row_count from public.user_ai_preferences;
  if row_count<>0 then raise exception 'Owner B can read another user preferences'; end if;
  update public.user_ai_preferences set text_model='malicious/overwrite'
   where user_id='33333333-3333-4333-8333-333333333333';
  if found then raise exception 'Owner B updated another user preferences'; end if;
  begin
    insert into public.user_ai_preferences(user_id,text_model)
    values ('33333333-3333-4333-8333-333333333333','malicious/insert');
    raise exception 'Owner B inserted preferences for another user';
  exception when insufficient_privilege then null;
  end;
end $owner_b$;
reset role;

set role anon;
do $anonymous$
begin
  begin
    perform * from public.user_ai_preferences;
    raise exception 'Anonymous role can read model preferences';
  exception when insufficient_privilege then null;
  end;
end $anonymous$;
reset role;

do $persisted$
begin
  if (select text_model from public.user_ai_preferences
      where user_id='33333333-3333-4333-8333-333333333333')
      <> 'anthropic/claude-sonnet-4' then
    raise exception 'Owner A update was not persisted';
  end if;
end $persisted$;

-- Approved content becomes a draft when its creative substance changes.
create or replace function public.forgecy_content_version() returns trigger
language plpgsql security invoker as $$
begin
 if old.title is distinct from new.title
    or old.caption is distinct from new.caption
    or old.slides is distinct from new.slides then
   if old.status='approved' then new.status:='draft'; end if;
 end if;
 new.revision:=old.revision+1;
 new.updated_at:=now();
 return new;
end $$;
-- Existing forgecy_content_version trigger from migration 0002 uses this function automatically.

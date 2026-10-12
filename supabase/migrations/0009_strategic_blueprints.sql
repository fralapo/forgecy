-- Forgecy V16: approved, versioned company strategies derived from approved current-state dossiers.
create table public.strategies(
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id) on delete cascade,
 dossier_id uuid not null references public.dossiers(id),
 ai_job_id uuid unique references public.ai_jobs(id) on delete set null,
 version integer not null check(version>0),
 status text not null default 'draft' check(status in ('draft','approved','stale')),
 knowledge_revision integer not null,
 blueprint jsonb not null,
 created_at timestamptz not null default now(),
 approved_at timestamptz,
 unique(client_id,version)
);
create index strategies_client_idx on public.strategies(client_id,version desc);
alter table public.strategies enable row level security;
create policy strategies_read on public.strategies for select to authenticated
 using(public.owns_forgecy_client(client_id));
revoke all on public.strategies from anon,authenticated;
grant select on public.strategies to authenticated;
grant select,insert,update,delete on public.strategies to service_role;

create or replace function public.forgecy_strategy_stale()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.knowledge_revision is distinct from new.knowledge_revision then
   update public.strategies set status='stale'
   where client_id=new.id and status in ('draft','approved');
 end if;
 return new;
end $$;
create trigger forgecy_strategy_knowledge_changed
 after update of knowledge_revision on public.clients for each row
 execute function public.forgecy_strategy_stale();

create or replace function public.approve_forgecy_strategy(
 p_client_id uuid,p_strategy_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare row_data public.strategies%rowtype; rev integer;
begin
 if not public.owns_forgecy_client(p_client_id) then
   raise exception 'Cliente non autorizzato';end if;
 select knowledge_revision into rev from public.clients
   where id=p_client_id for update;
 select * into row_data from public.strategies
   where id=p_strategy_id and client_id=p_client_id for update;
 if not found or row_data.status<>'draft' or row_data.knowledge_revision<>rev then
   raise exception 'Strategia non aggiornata o non approvabile';
 end if;
 if exists(select 1 from public.strategies where client_id=p_client_id and version>row_data.version) then
   raise exception 'Esiste una strategia piu recente';
 end if;
 if not exists(select 1 from public.dossiers where id=row_data.dossier_id
       and client_id=p_client_id and status='approved' and knowledge_revision=rev) then
   raise exception 'Il dossier collegato non e approvato';
 end if;
 update public.strategies set status='stale'
   where client_id=p_client_id and id<>p_strategy_id and status='approved';
 update public.strategies set status='approved',approved_at=now()
   where id=p_strategy_id;
 insert into public.audit_events(client_id,actor_id,action,target_id)
 values(p_client_id,auth.uid(),'strategy_approved',p_strategy_id);
 return p_strategy_id;
end $$;
revoke all on function public.approve_forgecy_strategy(uuid,uuid) from public,anon;
grant execute on function public.approve_forgecy_strategy(uuid,uuid) to authenticated;

-- Block approval of a proposed campaign when its strategy was invalidated in the meantime.
create or replace function public.forgecy_approved_strategy_required()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='approved' and (old.status is distinct from new.status) then
   if not exists (select 1 from public.strategies s join public.clients c on c.id=s.client_id
    where s.client_id=new.client_id and s.status='approved'
      and s.knowledge_revision=c.knowledge_revision) then
     raise exception 'Approva il piano strategico aggiornato prima della campagna';
   end if;
 end if;
 return new;
end $$;
create trigger forgecy_mission_strategy_gate before update of status on public.missions
 for each row execute function public.forgecy_approved_strategy_required();

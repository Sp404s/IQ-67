alter table public.negotiation_sessions
  add column if not exists title text,
  add column if not exists plan jsonb,
  add column if not exists parent_session_id uuid,
  add column if not exists root_session_id uuid,
  add column if not exists branched_from_turn integer,
  add column if not exists correction_number integer not null default 0,
  add column if not exists report jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'negotiation_sessions_parent_session_id_fkey'
  ) then
    alter table public.negotiation_sessions
      add constraint negotiation_sessions_parent_session_id_fkey
      foreign key (parent_session_id) references public.negotiation_sessions(id) on delete set null;
  end if;
end $$;

update public.negotiation_sessions
set title = coalesce(title, concat(player->>'role', ' — ', opponent->>'role')),
    updated_at = coalesce(updated_at, created_at)
where title is null;

create index if not exists negotiation_sessions_owner_updated_idx
  on public.negotiation_sessions(owner_id, updated_at desc);
create index if not exists negotiation_sessions_parent_idx
  on public.negotiation_sessions(parent_session_id);
create index if not exists negotiation_sessions_root_idx
  on public.negotiation_sessions(root_session_id);

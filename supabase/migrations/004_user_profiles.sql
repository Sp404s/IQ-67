create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists "users create own profile" on public.profiles;
create policy "users create own profile"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create index if not exists profiles_updated_at_idx on public.profiles(updated_at desc);

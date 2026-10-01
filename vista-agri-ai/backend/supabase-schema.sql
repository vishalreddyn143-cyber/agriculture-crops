-- VISTA AGRI AI: farmer login accounts.
-- Only the backend (service role) can access this table; RLS blocks browser keys.
create table if not exists public.farmers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null unique,
  phone text not null default '',
  preferred_language text not null default 'en',
  password_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.farmers enable row level security;
revoke all on table public.farmers from anon, authenticated;
grant select, insert, update, delete on table public.farmers to service_role;

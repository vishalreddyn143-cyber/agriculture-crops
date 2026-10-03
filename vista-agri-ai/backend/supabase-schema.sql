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

-- Face sign-in: the farmer's registered face photo (small JPEG data URL) and the
-- 128-number face descriptor computed from it, which sign-in scans are matched against.
alter table public.farmers add column if not exists face_descriptor jsonb;
alter table public.farmers add column if not exists face_photo text;

-- Connected cameras: each farmer's cameras and how the browser reaches them.
create table if not exists public.cameras (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references public.farmers(id) on delete cascade,
  name text not null,
  location text not null default '',
  type text not null check (type in ('device', 'hls', 'mjpeg')),
  stream_url text,
  device_id text,
  device_label text,
  ai_alerts boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists cameras_farmer_id_idx on public.cameras (farmer_id);

alter table public.cameras enable row level security;
revoke all on table public.cameras from anon, authenticated;
grant select, insert, update, delete on table public.cameras to service_role;

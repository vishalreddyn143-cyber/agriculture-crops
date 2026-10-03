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

-- Device live streaming: the WebRTC handshake between a farmer's streaming device and the
-- device watching it. Rows are short-lived; the video itself never passes through here.
create table if not exists public.live_streams (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references public.farmers(id) on delete cascade,
  device_name text not null default 'My device',
  offer text not null,
  answer text,
  status text not null default 'waiting' check (status in ('waiting', 'connected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists live_streams_farmer_id_idx on public.live_streams (farmer_id);

alter table public.live_streams enable row level security;
revoke all on table public.live_streams from anon, authenticated;
grant select, insert, update, delete on table public.live_streams to service_role;

-- Mission Control V1 — sessions and feed only
begin;

create table if not exists public.mission_control_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  mission_title text not null default 'Secure Production Deployment',
  status text not null default 'idle',
  progress_percent integer not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  current_phase text,
  eta_seconds integer,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mission_control_sessions_project
  on public.mission_control_sessions (project_id, created_at desc);

create table if not exists public.mission_control_feed_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id uuid references public.mission_control_sessions(id) on delete set null,
  message text not null,
  kind text not null default 'info',
  occurred_at timestamptz not null default now()
);

create index if not exists idx_mission_control_feed_project
  on public.mission_control_feed_events (project_id, occurred_at desc);

commit;

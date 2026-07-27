-- RT8: Authorization Team persistence
begin;

create table if not exists public.authorization_team_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  red_team_run_id uuid references public.red_team_runs(id) on delete set null,
  status text not null default 'running',
  environment_type text,
  commit_sha text,
  roles_detected integer not null default 0,
  resources_detected integer not null default 0,
  matrix_size integer not null default 0,
  authorization_graph jsonb not null default '{}'::jsonb,
  authorization_matrix jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_authorization_team_runs_project
  on public.authorization_team_runs (project_id, created_at desc);

create table if not exists public.authorization_team_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  authorization_team_run_id uuid not null references public.authorization_team_runs(id) on delete cascade,
  specialist_id text not null,
  category text not null,
  title text not null,
  severity text not null,
  confidence numeric not null default 0,
  status text not null default 'candidate',
  role text,
  resource text,
  action text,
  correlation_keys jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now()
);

create index if not exists idx_authorization_team_findings_run
  on public.authorization_team_findings (authorization_team_run_id, status);

create table if not exists public.authorization_replay_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  authorization_team_run_id uuid not null references public.authorization_team_runs(id) on delete cascade,
  finding_id uuid references public.authorization_team_findings(id) on delete set null,
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.authorization_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  authorization_team_run_id uuid not null references public.authorization_team_runs(id) on delete cascade,
  model jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

commit;

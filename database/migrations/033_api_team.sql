-- RT7: API Team persistence
begin;

create table if not exists public.api_team_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  red_team_run_id uuid references public.red_team_runs(id) on delete set null,
  authorization_id uuid references public.attack_authorizations(id) on delete set null,
  status text not null default 'running' check (
    status in ('queued', 'running', 'completed', 'partially_completed', 'failed', 'timed_out', 'cancelled')
  ),
  environment_type text,
  commit_sha text,
  target_origin text not null,
  endpoints_discovered integer not null default 0,
  scenarios_executed integer not null default 0,
  candidates_count integer not null default 0,
  confirmed_findings_count integer not null default 0,
  surface_inventory jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  failure_code text,
  failure_message_redacted text,
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_api_team_runs_project
  on public.api_team_runs (project_id, created_at desc);

create index if not exists idx_api_team_runs_active
  on public.api_team_runs (project_id, status)
  where status in ('queued', 'running');

create table if not exists public.api_team_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  api_team_run_id uuid not null references public.api_team_runs(id) on delete cascade,
  specialist_id text not null,
  category text not null,
  title text not null,
  severity text not null,
  confidence numeric not null default 0,
  status text not null default 'candidate',
  route text,
  method text,
  correlation_keys jsonb not null default '[]'::jsonb,
  safe_fix_eligible boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now()
);

create index if not exists idx_api_team_findings_run
  on public.api_team_findings (api_team_run_id, status);

create table if not exists public.api_replay_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  api_team_run_id uuid not null references public.api_team_runs(id) on delete cascade,
  finding_id uuid references public.api_team_findings(id) on delete set null,
  plan jsonb not null default '{}'::jsonb,
  replay_eligible boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_replay_plans_run
  on public.api_replay_plans (api_team_run_id);

create table if not exists public.api_safe_fix_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  finding_id uuid not null references public.api_team_findings(id) on delete cascade,
  safe_fix_candidate_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

commit;

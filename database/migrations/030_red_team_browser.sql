-- RT3: Red Team browser simulation persistence
begin;

create table if not exists public.attack_authorizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  target_origin text not null,
  environment_type text not null check (
    environment_type in ('local', 'preview', 'staging', 'production_safe')
  ),
  status text not null default 'approved' check (status in ('pending', 'approved', 'revoked', 'expired')),
  authorization_method text not null,
  approved_scope jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  test_credentials_ref text,
  path_exclusions jsonb not null default '[]'::jsonb,
  redirect_allowlist jsonb not null default '[]'::jsonb,
  max_request_budget integer not null default 200,
  max_duration_seconds integer not null default 900,
  commit_sha text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_attack_authorizations_project_active
  on public.attack_authorizations (project_id, status, expires_at desc);

create table if not exists public.red_team_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  authorization_id uuid references public.attack_authorizations(id) on delete set null,
  idempotency_key text,
  status text not null default 'requested' check (
    status in (
      'requested',
      'authorization_check',
      'queued',
      'provisioning',
      'exploring',
      'testing',
      'validating',
      'completed',
      'partially_completed',
      'failed',
      'timed_out',
      'cancelled'
    )
  ),
  commit_sha text,
  target_origin text,
  environment_type text,
  discovery_report_id text,
  failure_code text,
  failure_message text,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  execution_lease_token text,
  execution_lease_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_red_team_runs_idempotency
  on public.red_team_runs (project_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_red_team_runs_active
  on public.red_team_runs (project_id, status, created_at desc)
  where status in (
    'requested',
    'authorization_check',
    'queued',
    'provisioning',
    'exploring',
    'testing',
    'validating'
  );

create table if not exists public.browser_team_runs (
  id uuid primary key default gen_random_uuid(),
  red_team_run_id uuid not null references public.red_team_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'completed', 'partially_completed', 'failed', 'timed_out', 'cancelled')
  ),
  target_url text not null,
  routes_explored integer not null default 0,
  scenarios_executed integer not null default 0,
  candidates_count integer not null default 0,
  confirmed_findings_count integer not null default 0,
  route_graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  budget jsonb not null default '{}'::jsonb,
  failure_code text,
  failure_message_redacted text,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_browser_team_runs_red_team
  on public.browser_team_runs (red_team_run_id);

create table if not exists public.red_team_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  red_team_run_id uuid not null references public.red_team_runs(id) on delete cascade,
  browser_team_run_id uuid references public.browser_team_runs(id) on delete set null,
  team text not null default 'browser',
  specialist_id text not null,
  category text not null,
  title text not null,
  founder_summary text not null,
  technical_explanation text not null,
  affected_route text,
  severity text not null,
  confidence numeric not null default 0,
  status text not null default 'candidate' check (
    status in (
      'candidate',
      'validating',
      'confirmed',
      'rejected',
      'duplicate',
      'accepted_risk',
      'fixed',
      'verified'
    )
  ),
  correlation_keys jsonb not null default '[]'::jsonb,
  safe_fix_eligible boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_red_team_findings_run
  on public.red_team_findings (red_team_run_id, status);

create table if not exists public.red_team_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  finding_id uuid not null references public.red_team_findings(id) on delete cascade,
  kind text not null,
  route text,
  redacted_payload jsonb not null default '{}'::jsonb,
  screenshot_ref text,
  trace_ref text,
  created_at timestamptz not null default now()
);

create index if not exists idx_red_team_evidence_finding
  on public.red_team_evidence (finding_id);

commit;

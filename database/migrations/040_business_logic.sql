-- RT9: Business Logic Team production persistence
begin;

create table if not exists public.business_logic_runs (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  red_team_run_id uuid references public.red_team_runs(id) on delete set null,
  scan_job_id uuid references public.scan_jobs(id) on delete set null,
  idempotency_key text,
  schema_version integer not null default 1,
  status text not null default 'running' check (
    status in ('queued', 'running', 'completed', 'partially_completed', 'failed', 'skipped', 'cancelled')
  ),
  analysis_phase text not null default 'RT9_FINDINGS_COMPLETE',
  execution_mode text not null default 'analysis',
  commit_sha text,
  workflow_count integer not null default 0,
  fsm_count integer not null default 0,
  invariant_count integer not null default 0,
  abuse_case_count integer not null default 0,
  findings_count integer not null default 0,
  specialists_completed integer not null default 0,
  specialists_skipped integer not null default 0,
  specialists_failed integer not null default 0,
  runtime_executions_completed integer not null default 0,
  runtime_executions_failed integer not null default 0,
  coverage_percent numeric,
  duration_ms integer not null default 0,
  partial_persistence boolean not null default false,
  observability jsonb not null default '{}'::jsonb,
  execution_metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_business_logic_runs_idempotency
  on public.business_logic_runs (project_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_business_logic_runs_org
  on public.business_logic_runs (organization_id, created_at desc);

create index if not exists idx_business_logic_runs_project
  on public.business_logic_runs (project_id, created_at desc);

create index if not exists idx_business_logic_runs_scan_job
  on public.business_logic_runs (scan_job_id, created_at desc)
  where scan_job_id is not null;

create index if not exists idx_business_logic_runs_active
  on public.business_logic_runs (project_id, status)
  where status in ('queued', 'running', 'partially_completed');

create table if not exists public.business_logic_run_revisions (
  id uuid primary key default gen_random_uuid(),
  business_logic_run_id uuid not null references public.business_logic_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  revision integer not null,
  reason text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (business_logic_run_id, revision)
);

create index if not exists idx_business_logic_run_revisions_run
  on public.business_logic_run_revisions (business_logic_run_id, revision desc);

create table if not exists public.business_logic_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  business_logic_run_id uuid not null references public.business_logic_runs(id) on delete cascade,
  workflow_id text not null,
  kind text not null,
  label text not null,
  confidence numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (business_logic_run_id, workflow_id)
);

create index if not exists idx_business_logic_workflows_run
  on public.business_logic_workflows (business_logic_run_id);

create index if not exists idx_business_logic_workflows_project
  on public.business_logic_workflows (project_id, workflow_id);

create table if not exists public.business_logic_state_machines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  business_logic_run_id uuid not null references public.business_logic_runs(id) on delete cascade,
  workflow_id text not null,
  state_machine_id text not null,
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (business_logic_run_id, state_machine_id)
);

create index if not exists idx_business_logic_fsms_run
  on public.business_logic_state_machines (business_logic_run_id);

create index if not exists idx_business_logic_fsms_workflow
  on public.business_logic_state_machines (business_logic_run_id, workflow_id);

create table if not exists public.business_logic_invariants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  business_logic_run_id uuid not null references public.business_logic_runs(id) on delete cascade,
  invariant_id text not null,
  workflow_id text,
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (business_logic_run_id, invariant_id)
);

create index if not exists idx_business_logic_invariants_run
  on public.business_logic_invariants (business_logic_run_id);

create table if not exists public.business_logic_abuse_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  business_logic_run_id uuid not null references public.business_logic_runs(id) on delete cascade,
  abuse_case_id text not null,
  workflow_id text,
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (business_logic_run_id, abuse_case_id)
);

create index if not exists idx_business_logic_abuse_cases_run
  on public.business_logic_abuse_cases (business_logic_run_id);

create table if not exists public.business_logic_specialist_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  business_logic_run_id uuid not null references public.business_logic_runs(id) on delete cascade,
  specialist_id text not null,
  status text not null,
  duration_ms integer not null default 0,
  observation_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (business_logic_run_id, specialist_id)
);

create index if not exists idx_business_logic_specialist_results_run
  on public.business_logic_specialist_results (business_logic_run_id);

create index if not exists idx_business_logic_specialist_results_specialist
  on public.business_logic_specialist_results (specialist_id, created_at desc);

create table if not exists public.business_logic_runtime_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  business_logic_run_id uuid not null references public.business_logic_runs(id) on delete cascade,
  execution_id text not null,
  specialist_id text not null,
  workflow_id text not null,
  status text not null,
  duration_ms integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (business_logic_run_id, execution_id)
);

create index if not exists idx_business_logic_runtime_results_run
  on public.business_logic_runtime_results (business_logic_run_id);

create index if not exists idx_business_logic_runtime_results_execution
  on public.business_logic_runtime_results (execution_id);

create table if not exists public.business_logic_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  business_logic_run_id uuid not null references public.business_logic_runs(id) on delete cascade,
  finding_id text not null,
  workflow_id text not null,
  severity text not null,
  status text not null default 'candidate',
  confidence text not null,
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  discovered_at timestamptz not null default now(),
  unique (business_logic_run_id, finding_id)
);

create index if not exists idx_business_logic_findings_run
  on public.business_logic_findings (business_logic_run_id, status);

create index if not exists idx_business_logic_findings_workflow
  on public.business_logic_findings (business_logic_run_id, workflow_id);

create index if not exists idx_business_logic_findings_project
  on public.business_logic_findings (project_id, discovered_at desc);

create table if not exists public.business_logic_replay_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  business_logic_run_id uuid not null references public.business_logic_runs(id) on delete cascade,
  replay_plan_id text not null,
  finding_id text not null,
  executable boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (business_logic_run_id, replay_plan_id)
);

create index if not exists idx_business_logic_replay_plans_run
  on public.business_logic_replay_plans (business_logic_run_id);

create index if not exists idx_business_logic_replay_plans_finding
  on public.business_logic_replay_plans (finding_id);

commit;

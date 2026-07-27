-- RT13: Autonomous Security Orchestrator persistence
begin;

create table if not exists public.orchestrator_execution_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  plan jsonb not null default '{}'::jsonb,
  budget_mode text not null default 'balanced',
  confidence numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_orchestrator_execution_plans_project
  on public.orchestrator_execution_plans (project_id, created_at desc);

create table if not exists public.orchestrator_execution_graphs (
  id uuid primary key default gen_random_uuid(),
  execution_plan_id uuid not null references public.orchestrator_execution_plans(id) on delete cascade,
  graph jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.orchestrator_team_runs (
  id uuid primary key default gen_random_uuid(),
  execution_plan_id uuid not null references public.orchestrator_execution_plans(id) on delete cascade,
  team_id text not null,
  status text not null default 'planned',
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.orchestrator_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  execution_plan_id uuid references public.orchestrator_execution_plans(id) on delete set null,
  decision jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.orchestrator_execution_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  execution_plan_id uuid references public.orchestrator_execution_plans(id) on delete set null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

commit;

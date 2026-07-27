-- RT12: Fix Strategy Engine persistence
begin;

create table if not exists public.fix_strategies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  campaign_id text not null,
  strategy_revision integer not null default 1,
  status text not null default 'draft',
  root_causes jsonb not null default '[]'::jsonb,
  grouped_fixes jsonb not null default '[]'::jsonb,
  strategies jsonb not null default '[]'::jsonb,
  replay_links jsonb not null default '[]'::jsonb,
  safe_fix_score jsonb not null default '{}'::jsonb,
  estimated_effort jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fix_strategies_project
  on public.fix_strategies (project_id, created_at desc);

create table if not exists public.implementation_prompts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  fix_strategy_id uuid not null references public.fix_strategies(id) on delete cascade,
  prompt text not null,
  prompt_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.verification_prompts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  fix_strategy_id uuid not null references public.fix_strategies(id) on delete cascade,
  prompt text not null,
  prompt_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.engineering_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  fix_strategy_id uuid not null references public.fix_strategies(id) on delete cascade,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

commit;

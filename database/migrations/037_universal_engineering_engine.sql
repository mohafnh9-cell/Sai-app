-- RT12 UEE: Universal Engineering Engine persistence
begin;

create table if not exists public.engineering_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  campaign_id text not null,
  plan_version integer not null default 1,
  plan jsonb not null default '{}'::jsonb,
  selected_strategy text,
  estimated_complexity text,
  confidence_score numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_engineering_plans_project
  on public.engineering_plans (project_id, created_at desc);

create table if not exists public.engineering_versions (
  id uuid primary key default gen_random_uuid(),
  engineering_plan_id uuid not null references public.engineering_plans(id) on delete cascade,
  version integer not null,
  reason text,
  plan_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.verification_plans (
  id uuid primary key default gen_random_uuid(),
  engineering_plan_id uuid not null references public.engineering_plans(id) on delete cascade,
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_prompts (
  id uuid primary key default gen_random_uuid(),
  engineering_plan_id uuid not null references public.engineering_plans(id) on delete cascade,
  adapter_id text not null,
  prompt text not null,
  token_estimate integer not null default 0,
  prompt_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_prompts_plan_adapter
  on public.ai_prompts (engineering_plan_id, adapter_id);

create table if not exists public.adapter_outputs (
  id uuid primary key default gen_random_uuid(),
  engineering_plan_id uuid not null references public.engineering_plans(id) on delete cascade,
  adapter_id text not null,
  format text not null default 'prompt',
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.engineering_reports (
  id uuid primary key default gen_random_uuid(),
  engineering_plan_id uuid not null references public.engineering_plans(id) on delete cascade,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

commit;

-- Sprint 3: Production Memory layer (Postgres only)
begin;

-- ─── protection_events (append-only) ─────────────────────────────
create table if not exists public.protection_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  scan_id uuid references public.scans(id) on delete set null,
  scan_job_id uuid references public.scan_jobs(id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint protection_events_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create unique index if not exists idx_protection_events_idempotency
  on public.protection_events (project_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_protection_events_project_time
  on public.protection_events (project_id, occurred_at desc);

create index if not exists idx_protection_events_org_time
  on public.protection_events (organization_id, occurred_at desc);

-- ─── protection_snapshots (daily / per-review rollup) ───────────
create table if not exists public.protection_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  snapshot_date date not null,
  production_confidence smallint check (production_confidence is null or production_confidence between 0 and 100),
  security_confidence smallint check (security_confidence is null or security_confidence between 0 and 100),
  health_score smallint check (health_score is null or health_score between 0 and 100),
  health_label text check (
    health_label is null or health_label in ('excellent', 'good', 'needs_attention', 'at_risk')
  ),
  protection_status text not null default 'not_protected' check (
    protection_status in ('protected', 'safe_with_caution', 'requires_attention', 'not_protected')
  ),
  protection_health text check (
    protection_health is null or protection_health in ('strong', 'steady', 'at_risk', 'unwatched')
  ),
  production_health text check (
    production_health is null or production_health in ('excellent', 'good', 'needs_attention', 'at_risk')
  ),
  security_health text check (
    security_health is null or security_health in ('excellent', 'good', 'needs_attention', 'at_risk')
  ),
  deploy_answer text check (deploy_answer is null or deploy_answer in ('go', 'no_go', 'not_yet')),
  worries_top3 jsonb not null default '[]'::jsonb,
  open_critical_high_count smallint not null default 0,
  content_hash text not null default '',
  source_verdict_id uuid references public.production_verdicts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint protection_snapshots_project_date unique (project_id, snapshot_date),
  constraint protection_snapshots_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_protection_snapshots_project_date
  on public.protection_snapshots (project_id, snapshot_date desc);

-- ─── protection_recommendations ─────────────────────────────────
create table if not exists public.protection_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  finding_stable_id text,
  title_plain text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  status text not null default 'open' check (status in ('open', 'applied', 'dismissed', 'verified')),
  safe_fix_fingerprint text,
  source_verdict_id uuid references public.production_verdicts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint protection_recommendations_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_protection_recommendations_project_status
  on public.protection_recommendations (project_id, status);

-- ─── protection_deployments ─────────────────────────────────────
create table if not exists public.protection_deployments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  sha text,
  branch text,
  deploy_answer text not null check (deploy_answer in ('go', 'no_go', 'not_yet')),
  production_confidence smallint check (production_confidence is null or production_confidence between 0 and 100),
  security_confidence smallint check (security_confidence is null or security_confidence between 0 and 100),
  source text not null check (source in ('mcp', 'web', 'github_push')),
  verdict_id uuid references public.production_verdicts(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint protection_deployments_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_protection_deployments_project_time
  on public.protection_deployments (project_id, occurred_at desc);

-- ─── project_memory_profile (1:1 project) ───────────────────────
create table if not exists public.project_memory_profile (
  project_id uuid primary key references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stack_fingerprint jsonb not null default '[]'::jsonb,
  project_created_at timestamptz,
  first_protected_at timestamptz,
  continuous_protection_days integer not null default 0,
  total_daily_checks integer not null default 0,
  total_unsafe_prevented integer not null default 0,
  total_critical_fixed integer not null default 0,
  lifetime_production_confidence_delta smallint,
  lifetime_security_confidence_delta smallint,
  last_material_change_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint project_memory_profile_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

-- ─── protection_milestones ──────────────────────────────────────
create table if not exists public.protection_milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  milestone_type text not null,
  occurred_at timestamptz not null default now(),
  title_plain text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint protection_milestones_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create unique index if not exists idx_protection_milestones_idempotency
  on public.protection_milestones (project_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_protection_milestones_project_time
  on public.protection_milestones (project_id, occurred_at desc);

-- ─── RLS: members read; writes via service role ─────────────────
alter table public.protection_events enable row level security;
alter table public.protection_snapshots enable row level security;
alter table public.protection_recommendations enable row level security;
alter table public.protection_deployments enable row level security;
alter table public.project_memory_profile enable row level security;
alter table public.protection_milestones enable row level security;

create policy "Members read protection events"
  on public.protection_events for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = protection_events.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read protection snapshots"
  on public.protection_snapshots for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = protection_snapshots.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read protection recommendations"
  on public.protection_recommendations for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = protection_recommendations.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read protection deployments"
  on public.protection_deployments for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = protection_deployments.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read project memory profile"
  on public.project_memory_profile for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = project_memory_profile.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read protection milestones"
  on public.protection_milestones for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = protection_milestones.organization_id and m.user_id = auth.uid()
    )
  );

commit;

-- Sprint 4: Continuous Protection settings & weekly summaries
begin;

create table if not exists public.project_continuous_protection (
  project_id uuid primary key references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  paused_at timestamptz,
  timezone text not null default 'UTC',
  last_daily_completed_at timestamptz,
  last_weekly_completed_at timestamptz,
  consecutive_daily_failures smallint not null default 0,
  lockfile_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_continuous_protection_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_project_cp_org_enabled
  on public.project_continuous_protection (organization_id, enabled)
  where enabled = true and paused_at is null;

create table if not exists public.protection_weekly_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  week_start date not null,
  status_at_end text not null check (
    status_at_end in ('protected', 'safe_with_caution', 'requires_attention', 'not_protected')
  ),
  summary jsonb not null default '{}'::jsonb,
  narrative text not null default '',
  checks_completed smallint not null default 0,
  production_confidence_start smallint,
  production_confidence_end smallint,
  security_confidence_start smallint,
  security_confidence_end smallint,
  primary_recommendation text,
  created_at timestamptz not null default now(),
  constraint protection_weekly_summaries_project_week unique (project_id, week_start),
  constraint protection_weekly_summaries_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_protection_weekly_summaries_project
  on public.protection_weekly_summaries (project_id, week_start desc);

alter table public.project_continuous_protection enable row level security;
alter table public.protection_weekly_summaries enable row level security;

create policy "Members read project continuous protection"
  on public.project_continuous_protection for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = project_continuous_protection.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read protection weekly summaries"
  on public.protection_weekly_summaries for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = protection_weekly_summaries.organization_id and m.user_id = auth.uid()
    )
  );

commit;

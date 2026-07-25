-- Sprint 7: Safe Fix Engine V2 — history, lifecycle, verification, PR drafts
begin;

create table if not exists public.safe_fix_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  recommendation_id text not null,
  review_id uuid references public.scans(id) on delete set null,
  verdict_id uuid references public.production_verdicts(id) on delete set null,
  lifecycle_state text not null default 'PROPOSED'
    check (lifecycle_state in (
      'PROPOSED', 'READY', 'APPROVED', 'APPLIED', 'VERIFYING', 'VERIFIED', 'FAILED', 'SUPERSEDED'
    )),
  confidence_band text not null check (confidence_band in ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH')),
  confidence_score smallint not null check (confidence_score between 0 and 100),
  document jsonb not null default '{}'::jsonb,
  pr_draft jsonb not null default '{}'::jsonb,
  baseline_snapshot jsonb not null default '{}'::jsonb,
  confidence_delta smallint,
  protection_delta text,
  superseded_by uuid references public.safe_fix_records(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safe_fix_records_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_safe_fix_records_project
  on public.safe_fix_records (project_id, created_at desc);

create index if not exists idx_safe_fix_records_recommendation
  on public.safe_fix_records (project_id, recommendation_id, lifecycle_state);

create table if not exists public.safe_fix_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  safe_fix_id uuid not null references public.safe_fix_records(id) on delete cascade,
  from_state text,
  to_state text not null,
  actor text not null default 'system',
  reason text not null default '',
  related_review_id uuid references public.scans(id) on delete set null,
  related_recommendation_id text,
  created_at timestamptz not null default now(),
  constraint safe_fix_lifecycle_events_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_safe_fix_lifecycle_safe_fix
  on public.safe_fix_lifecycle_events (safe_fix_id, created_at desc);

create table if not exists public.safe_fix_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  safe_fix_id uuid not null references public.safe_fix_records(id) on delete cascade,
  outcome text not null check (outcome in ('passed', 'failed', 'partial')),
  issue_disappeared boolean not null default false,
  production_confidence_improved boolean not null default false,
  protection_status_improved boolean not null default false,
  new_issues_introduced boolean not null default false,
  production_confidence_before smallint,
  production_confidence_after smallint,
  protection_status_before text,
  protection_status_after text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint safe_fix_verifications_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_safe_fix_verifications_project
  on public.safe_fix_verifications (project_id, created_at desc);

alter table public.safe_fix_records enable row level security;
alter table public.safe_fix_lifecycle_events enable row level security;
alter table public.safe_fix_verifications enable row level security;

create policy "Members read safe fix records"
  on public.safe_fix_records for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = safe_fix_records.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read safe fix lifecycle"
  on public.safe_fix_lifecycle_events for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = safe_fix_lifecycle_events.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read safe fix verifications"
  on public.safe_fix_verifications for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = safe_fix_verifications.organization_id and m.user_id = auth.uid()
    )
  );

commit;

-- Sprint 6: Protection Reports (weekly + monthly + timeline)
begin;

create table if not exists public.protection_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  report_type text not null check (report_type in ('weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  version integer not null default 1,
  is_current boolean not null default true,
  dedupe_key text not null,
  founder_summary jsonb not null default '{}'::jsonb,
  report_data jsonb not null default '{}'::jsonb,
  narrative text not null default '',
  generated_at timestamptz not null default now(),
  regenerated_at timestamptz,
  constraint protection_reports_dedupe unique (project_id, dedupe_key, version),
  constraint protection_reports_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_protection_reports_project_current
  on public.protection_reports (project_id, report_type, is_current, period_start desc);

create table if not exists public.protection_timeline_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  occurred_at timestamptz not null,
  episode_kind text not null check (
    episode_kind in (
      'weekly_milestone',
      'monthly_milestone',
      'protection_improvement',
      'confidence_change',
      'important_event'
    )
  ),
  period_key text not null,
  icon text not null default 'watch',
  title_plain text not null,
  subtitle_plain text not null default '',
  payload jsonb not null default '{}'::jsonb,
  source_report_id uuid references public.protection_reports(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint protection_timeline_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_protection_timeline_project_time
  on public.protection_timeline_entries (project_id, occurred_at desc);

alter table public.protection_reports enable row level security;
alter table public.protection_timeline_entries enable row level security;

create policy "Members read protection reports"
  on public.protection_reports for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = protection_reports.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read protection timeline"
  on public.protection_timeline_entries for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = protection_timeline_entries.organization_id and m.user_id = auth.uid()
    )
  );

commit;

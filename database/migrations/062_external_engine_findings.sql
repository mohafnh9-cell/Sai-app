-- Phase 35: persistence for findings produced by the new multi-engine
-- security layer (OpenGrep, Trivy, native Crypto engine, OpenSSF Scorecard --
-- server/security-engines/*). Additive only, mirrors the existing
-- scan_findings table's shape so both can be queried/correlated uniformly,
-- but kept as its own table (not a migration of scan_findings) so the
-- existing native-scanner write path is never touched by this phase.
--
-- Reuses Phase 34's finding_correlations/attack_chains tables (migration
-- 061) for cross-engine deduplication output -- no second correlation
-- table/system is introduced (Phase 35 brief, section 24).

create table if not exists public.external_engine_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  engine text not null check (engine in ('opengrep', 'trivy', 'crypto', 'scorecard')),
  engine_version text not null,
  execution_id text not null,
  finding_id text not null,
  fingerprint text not null,
  title text not null,
  description text not null,
  category text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  verification_status text not null,
  exploitability jsonb not null default '{}'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  affected_files jsonb not null default '[]'::jsonb,
  affected_assets jsonb not null default '[]'::jsonb,
  remediation text,
  cwe jsonb not null default '[]'::jsonb,
  owasp jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'external_engine_findings_tenant_fk'
      and conrelid = 'public.external_engine_findings'::regclass
  ) then
    alter table public.external_engine_findings
      add constraint external_engine_findings_tenant_fk
      foreign key (project_id, organization_id)
      references public.projects (id, organization_id)
      on delete cascade;
  end if;
end
$$;

create index if not exists idx_external_engine_findings_scan
  on public.external_engine_findings (scan_id);
create index if not exists idx_external_engine_findings_project_org
  on public.external_engine_findings (project_id, organization_id, created_at desc);
create index if not exists idx_external_engine_findings_engine
  on public.external_engine_findings (scan_id, engine);

alter table public.external_engine_findings enable row level security;

drop policy if exists "Members read external engine findings" on public.external_engine_findings;
create policy "Members read external engine findings"
  on public.external_engine_findings for select
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = external_engine_findings.organization_id
        and m.user_id = auth.uid()
    )
  );

drop trigger if exists set_external_engine_findings_updated_at on public.external_engine_findings;
create trigger set_external_engine_findings_updated_at
  before update on public.external_engine_findings
  for each row execute function public.set_updated_at();

-- Structured per-engine execution metadata (section 4): one row per engine
-- run per scan, independent of whether it produced any findings -- this is
-- what makes "OpenGrep: FAILED, coverage: incomplete" representable and
-- queryable (section 22/23), not inferred from absence of findings rows.
create table if not exists public.engine_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  engine text not null check (engine in ('opengrep', 'trivy', 'crypto', 'scorecard')),
  engine_version text not null,
  execution_id text not null,
  status text not null check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'SKIPPED')),
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms integer not null default 0,
  capabilities_attempted jsonb not null default '[]'::jsonb,
  capabilities_completed jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'engine_executions_tenant_fk'
      and conrelid = 'public.engine_executions'::regclass
  ) then
    alter table public.engine_executions
      add constraint engine_executions_tenant_fk
      foreign key (project_id, organization_id)
      references public.projects (id, organization_id)
      on delete cascade;
  end if;
end
$$;

create index if not exists idx_engine_executions_scan
  on public.engine_executions (scan_id);

alter table public.engine_executions enable row level security;

drop policy if exists "Members read engine executions" on public.engine_executions;
create policy "Members read engine executions"
  on public.engine_executions for select
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = engine_executions.organization_id
        and m.user_id = auth.uid()
    )
  );

-- Writes to all tables in this migration remain service-role only (no
-- insert/update/delete policy defined), matching every other Phase 34/35
-- table.

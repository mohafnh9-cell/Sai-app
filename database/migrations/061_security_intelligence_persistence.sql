-- Phase 34: persist the correlation-engine / attack-chain-builder output that
-- server/ai-red-team/intelligence/{correlation-engine.ts,attack-chain-builder.ts}
-- already computes on every scan that reaches the unified red-team phase, but
-- which today is discarded to a bare count + string summaries before
-- persistence (see server/platform-convergence/build-scan-metadata.ts
-- intelligenceSummary). Additive only: no existing table, column, or row is
-- touched or dropped.
--
-- Findings referenced by finding_ids are ephemeral, per-report AttackFinding
-- ids (server/ai-red-team/types/attack-models.ts) that are not themselves
-- durably persisted elsewhere yet, so each row also carries a denormalized
-- findings_snapshot capturing the fields (id, title, severity, confidence,
-- domain) needed to make the row self-contained without a join.

create table if not exists public.finding_correlations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  intelligence_report_id text not null,
  kind text not null check (
    kind in ('same_issue', 'independent', 'attack_chain', 'duplicate', 'supporting_evidence', 'possible_exploit_path')
  ),
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  rationale text not null,
  finding_ids jsonb not null default '[]'::jsonb,
  findings_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'finding_correlations_tenant_fk'
      and conrelid = 'public.finding_correlations'::regclass
  ) then
    alter table public.finding_correlations
      add constraint finding_correlations_tenant_fk
      foreign key (project_id, organization_id)
      references public.projects (id, organization_id)
      on delete cascade;
  end if;
end
$$;

create index if not exists idx_finding_correlations_scan
  on public.finding_correlations (scan_id);
create index if not exists idx_finding_correlations_project_org
  on public.finding_correlations (project_id, organization_id, created_at desc);

alter table public.finding_correlations enable row level security;

drop policy if exists "Members read finding correlations" on public.finding_correlations;
create policy "Members read finding correlations"
  on public.finding_correlations for select
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = finding_correlations.organization_id
        and m.user_id = auth.uid()
    )
  );

create table if not exists public.attack_chains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  intelligence_report_id text not null,
  title text not null,
  summary text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  score numeric not null default 0,
  status text not null default 'POTENTIAL' check (status in ('POTENTIAL', 'PARTIALLY_VALIDATED', 'CONFIRMED')),
  status_rationale text not null default '',
  finding_ids jsonb not null default '[]'::jsonb,
  findings_snapshot jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  evidence_ids jsonb not null default '[]'::jsonb,
  affected_assets jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'attack_chains_tenant_fk'
      and conrelid = 'public.attack_chains'::regclass
  ) then
    alter table public.attack_chains
      add constraint attack_chains_tenant_fk
      foreign key (project_id, organization_id)
      references public.projects (id, organization_id)
      on delete cascade;
  end if;
end
$$;

create index if not exists idx_attack_chains_scan
  on public.attack_chains (scan_id);
create index if not exists idx_attack_chains_project_org
  on public.attack_chains (project_id, organization_id, created_at desc);
create index if not exists idx_attack_chains_status
  on public.attack_chains (project_id, status);

alter table public.attack_chains enable row level security;

drop policy if exists "Members read attack chains" on public.attack_chains;
create policy "Members read attack chains"
  on public.attack_chains for select
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_chains.organization_id
        and m.user_id = auth.uid()
    )
  );

drop trigger if exists set_attack_chains_updated_at on public.attack_chains;
create trigger set_attack_chains_updated_at
  before update on public.attack_chains
  for each row execute function public.set_updated_at();

-- Writes to both tables remain service-role only (no insert/update/delete
-- policy defined), matching the existing dynamic_target_verifications and
-- attack_simulation_findings convention.

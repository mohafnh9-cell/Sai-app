-- Phase 30: selective AI reasoning overlay for Category C findings
-- (authz.insufficient, injection.ssrf, api.mass-assignment,
-- frontend.client-authz -- see
-- features/security-scanner/rules/ai-reasoning-classification.ts).
--
-- Deliberately a separate table from ai_reports: this overlay is generated
-- asynchronously post-verdict by a different trigger (selective, only when
-- eligible findings exist) and must never gate or block Production Verdict
-- persistence, which is immutable-per-scan once written. Storing this
-- overlay in its own row (rather than mutating an already-persisted verdict
-- or ai_reports row) keeps AI reasoning purely additive: it can arrive
-- late, fail, or be skipped without touching anything already committed.
begin;

create table if not exists public.ai_finding_reasoning (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null unique references public.scans(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'skipped')),
  reasoning_version text not null default 'v1',
  model text,
  -- Deterministic finding ids this reasoning pass actually analyzed --
  -- always a subset of scan_findings.id for this scan, never arbitrary.
  analyzed_finding_ids uuid[] not null default '{}',
  -- Stable hash over (version + sorted analyzed finding/rule ids), used to
  -- detect when underlying evidence changed so stale reasoning is never
  -- silently reused across a rescan.
  evidence_hash text not null,
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  attack_chains jsonb not null default '[]'::jsonb check (jsonb_typeof(attack_chains) = 'array'),
  failure_reason text,
  tokens_used integer not null default 0 check (tokens_used >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  cache_hit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_finding_reasoning_org_idx
  on public.ai_finding_reasoning (organization_id);
create index if not exists ai_finding_reasoning_project_idx
  on public.ai_finding_reasoning (project_id);
-- Cache lookups: find prior completed reasoning for the same evidence within a project.
create index if not exists ai_finding_reasoning_evidence_hash_idx
  on public.ai_finding_reasoning (project_id, evidence_hash) where status = 'completed';

alter table public.ai_finding_reasoning enable row level security;

drop policy if exists "Members read ai finding reasoning" on public.ai_finding_reasoning;
create policy "Members read ai finding reasoning" on public.ai_finding_reasoning for select using (
  exists (
    select 1 from public.organization_members m
    where m.organization_id = ai_finding_reasoning.organization_id and m.user_id = auth.uid()
  )
);

commit;

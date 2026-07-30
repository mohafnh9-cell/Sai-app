-- Slice 1: Attack Simulation Engine (ASE) — canonical persistence.
-- AttackCampaign is the root aggregate for a full Production Review attack simulation run.
begin;

create table if not exists public.attack_simulation_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  scan_job_id uuid references public.scan_jobs(id) on delete set null,
  authorization_id uuid references public.attack_authorizations(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  commit_sha text not null,
  runtime_mode text not null check (
    runtime_mode in ('static', 'mock', 'sandbox', 'authorized_staging', 'blocked', 'unsupported')
  ),
  status text not null default 'planned' check (
    status in (
      'planned', 'queued', 'preparing', 'running', 'paused',
      'completing', 'completed', 'failed', 'cancelled'
    )
  ),
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  estimated_remaining_ms integer check (estimated_remaining_ms is null or estimated_remaining_ms >= 0),
  total_scenarios integer not null default 0 check (total_scenarios >= 0),
  total_executions integer not null default 0 check (total_executions >= 0),
  completed_executions integer not null default 0 check (completed_executions >= 0),
  confirmed_findings integer not null default 0 check (confirmed_findings >= 0),
  blocked_executions integer not null default 0 check (blocked_executions >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  failure_code text,
  safe_failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attack_simulation_campaigns_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create unique index if not exists idx_attack_simulation_campaigns_scan
  on public.attack_simulation_campaigns (scan_id);

create index if not exists idx_attack_simulation_campaigns_project_status
  on public.attack_simulation_campaigns (project_id, status, updated_at desc);

create table if not exists public.attack_simulation_scenarios (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.attack_simulation_campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  hypothesis_id text not null,
  adapter_id text not null,
  category text not null,
  title text not null,
  description text not null default '',
  status text not null default 'planned' check (
    status in ('planned', 'queued', 'running', 'completed', 'failed', 'skipped', 'cancelled')
  ),
  sort_order integer not null default 0 check (sort_order >= 0),
  red_team_source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attack_simulation_scenarios_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_attack_simulation_scenarios_campaign
  on public.attack_simulation_scenarios (campaign_id, sort_order);

create table if not exists public.attack_simulation_executions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.attack_simulation_campaigns(id) on delete cascade,
  scenario_id uuid not null references public.attack_simulation_scenarios(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  scan_job_id uuid references public.scan_jobs(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  commit_sha text not null,
  runtime_mode text not null check (
    runtime_mode in ('static', 'mock', 'sandbox', 'authorized_staging', 'blocked', 'unsupported')
  ),
  attacker_profile jsonb not null default '{}'::jsonb,
  protected_assets jsonb not null default '[]'::jsonb,
  status text not null default 'planned' check (
    status in (
      'planned', 'queued', 'preparing', 'validating_preconditions', 'creating_fixtures',
      'executing', 'observing', 'collecting_evidence', 'evaluating', 'confirmed',
      'not_exploitable', 'blocked', 'generating_mitigation', 'fix_ready', 'applying_fix',
      'replaying', 'protected', 'still_vulnerable', 'cleaning_up', 'completed', 'failed', 'cancelled'
    )
  ),
  current_stage text not null default 'planned' check (
    current_stage in (
      'planned', 'queued', 'preparing', 'validating_preconditions', 'creating_fixtures',
      'executing', 'observing', 'collecting_evidence', 'evaluating', 'confirmed',
      'not_exploitable', 'blocked', 'generating_mitigation', 'fix_ready', 'applying_fix',
      'replaying', 'protected', 'still_vulnerable', 'cleaning_up', 'completed', 'failed', 'cancelled'
    )
  ),
  current_step_id uuid,
  current_step_title text,
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  estimated_remaining_ms integer check (estimated_remaining_ms is null or estimated_remaining_ms >= 0),
  elapsed_ms integer not null default 0 check (elapsed_ms >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  failure_code text,
  safe_failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attack_simulation_executions_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_attack_simulation_executions_campaign
  on public.attack_simulation_executions (campaign_id, status, updated_at desc);

create index if not exists idx_attack_simulation_executions_scenario
  on public.attack_simulation_executions (scenario_id);

create table if not exists public.attack_simulation_execution_steps (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.attack_simulation_executions(id) on delete cascade,
  campaign_id uuid not null references public.attack_simulation_campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order >= 0),
  kind text not null,
  label text not null,
  weight integer not null check (weight > 0 and weight <= 100),
  status text not null default 'pending' check (
    status in ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled')
  ),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  failure_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attack_simulation_execution_steps_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  unique (execution_id, sort_order)
);

create index if not exists idx_attack_simulation_execution_steps_execution
  on public.attack_simulation_execution_steps (execution_id, sort_order);

alter table public.attack_simulation_executions
  add constraint attack_simulation_executions_current_step_fk
  foreign key (current_step_id) references public.attack_simulation_execution_steps(id) on delete set null;

create table if not exists public.attack_simulation_execution_plans (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.attack_simulation_executions(id) on delete cascade,
  campaign_id uuid not null references public.attack_simulation_campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  step_ids uuid[] not null default '{}',
  total_weight integer not null check (total_weight > 0),
  plan_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint attack_simulation_execution_plans_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create unique index if not exists idx_attack_simulation_execution_plans_execution
  on public.attack_simulation_execution_plans (execution_id);

create table if not exists public.attack_simulation_evidence (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.attack_simulation_executions(id) on delete cascade,
  campaign_id uuid not null references public.attack_simulation_campaigns(id) on delete cascade,
  scenario_id uuid not null references public.attack_simulation_scenarios(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  commit_sha text not null,
  environment text not null check (
    environment in ('static', 'mock', 'sandbox', 'authorized_staging', 'blocked', 'unsupported')
  ),
  expected_behavior text not null default '',
  observed_behavior text not null default '',
  redacted_request jsonb not null default '{}'::jsonb,
  redacted_response jsonb not null default '{}'::jsonb,
  status_code integer check (status_code is null or (status_code >= 0 and status_code <= 999)),
  side_effects jsonb not null default '{}'::jsonb,
  preconditions jsonb not null default '{}'::jsonb,
  attack_profile jsonb not null default '{}'::jsonb,
  protected_assets jsonb not null default '[]'::jsonb,
  reproducibility text not null default '',
  confidence numeric(4,3) not null default 0 check (confidence >= 0 and confidence <= 1),
  replay_instructions text not null default '',
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint attack_simulation_evidence_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_attack_simulation_evidence_execution
  on public.attack_simulation_evidence (execution_id, captured_at desc);

create table if not exists public.attack_simulation_findings (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.attack_simulation_executions(id) on delete cascade,
  campaign_id uuid not null references public.attack_simulation_campaigns(id) on delete cascade,
  scenario_id uuid not null references public.attack_simulation_scenarios(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  evidence_id uuid references public.attack_simulation_evidence(id) on delete set null,
  title text not null,
  description text not null default '',
  category text not null,
  severity text not null check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  confidence numeric(4,3) not null default 0 check (confidence >= 0 and confidence <= 1),
  outcome text not null default 'pending' check (
    outcome in ('pending', 'confirmed', 'not_exploitable', 'inconclusive')
  ),
  impact text not null default '',
  root_cause text,
  metadata jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attack_simulation_findings_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_attack_simulation_findings_campaign
  on public.attack_simulation_findings (campaign_id, outcome);

create table if not exists public.attack_simulation_mitigations (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.attack_simulation_findings(id) on delete cascade,
  execution_id uuid not null references public.attack_simulation_executions(id) on delete cascade,
  campaign_id uuid not null references public.attack_simulation_campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  plain_language_explanation text not null default '',
  root_cause text not null default '',
  recommended_protection text not null default '',
  likely_affected_files jsonb not null default '[]'::jsonb,
  implementation_steps jsonb not null default '[]'::jsonb,
  implementation_risk text not null check (implementation_risk in ('low', 'medium', 'high')),
  safe_fix_confidence numeric(4,3) not null default 0 check (safe_fix_confidence >= 0 and safe_fix_confidence <= 1),
  estimated_loc integer check (estimated_loc is null or estimated_loc >= 0),
  rollback_guidance text not null default '',
  residual_risk text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attack_simulation_mitigations_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table if not exists public.attack_simulation_safe_fixes (
  id uuid primary key default gen_random_uuid(),
  mitigation_id uuid not null references public.attack_simulation_mitigations(id) on delete cascade,
  finding_id uuid not null references public.attack_simulation_findings(id) on delete cascade,
  execution_id uuid not null references public.attack_simulation_executions(id) on delete cascade,
  campaign_id uuid not null references public.attack_simulation_campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  safe_fix_record_id uuid references public.safe_fix_records(id) on delete set null,
  status text not null default 'draft' check (
    status in ('draft', 'ready', 'applied', 'verified', 'failed', 'superseded')
  ),
  cursor_prompt text not null default '',
  patch_proposal jsonb,
  pull_request_proposal jsonb,
  required_tests jsonb not null default '[]'::jsonb,
  rollback_plan text not null default '',
  affected_files jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) not null default 0 check (confidence >= 0 and confidence <= 1),
  implementation_risk text not null check (implementation_risk in ('low', 'medium', 'high')),
  estimated_loc integer check (estimated_loc is null or estimated_loc >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attack_simulation_safe_fixes_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table if not exists public.attack_simulation_replays (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.attack_simulation_campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  original_execution_id uuid not null references public.attack_simulation_executions(id) on delete cascade,
  replay_execution_id uuid not null references public.attack_simulation_executions(id) on delete cascade,
  finding_id uuid references public.attack_simulation_findings(id) on delete set null,
  safe_fix_id uuid references public.attack_simulation_safe_fixes(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attack_simulation_replays_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table if not exists public.attack_simulation_protection_verifications (
  id uuid primary key default gen_random_uuid(),
  replay_id uuid not null references public.attack_simulation_replays(id) on delete cascade,
  campaign_id uuid not null references public.attack_simulation_campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  original_execution_id uuid not null references public.attack_simulation_executions(id) on delete cascade,
  replay_execution_id uuid not null references public.attack_simulation_executions(id) on delete cascade,
  finding_id uuid references public.attack_simulation_findings(id) on delete set null,
  outcome text not null check (outcome in ('protected', 'still_vulnerable', 'inconclusive')),
  original_evidence_id uuid references public.attack_simulation_evidence(id) on delete set null,
  replay_evidence_id uuid references public.attack_simulation_evidence(id) on delete set null,
  comparison jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attack_simulation_protection_verifications_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table if not exists public.attack_simulation_runtime_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.attack_simulation_campaigns(id) on delete cascade,
  execution_id uuid references public.attack_simulation_executions(id) on delete cascade,
  step_id uuid references public.attack_simulation_execution_steps(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  correlation_id uuid not null,
  event_type text not null check (
    event_type in (
      'attack_campaign_started', 'attack_planned', 'attack_preconditions_validated',
      'attack_execution_started', 'attack_step_started', 'attack_step_completed',
      'attack_evidence_collected', 'attack_confirmed', 'attack_not_exploitable',
      'attack_blocked', 'mitigation_generation_started', 'safe_fix_ready',
      'safe_fix_applied', 'attack_replay_started', 'protection_verified',
      'attack_still_vulnerable', 'attack_cleanup_completed', 'attack_failed', 'attack_cancelled'
    )
  ),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint attack_simulation_runtime_events_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_attack_simulation_runtime_events_campaign
  on public.attack_simulation_runtime_events (campaign_id, occurred_at desc);

create index if not exists idx_attack_simulation_runtime_events_project_live
  on public.attack_simulation_runtime_events (project_id, occurred_at desc);

-- Row level security (read for org members; writes via service role)
alter table public.attack_simulation_campaigns enable row level security;
alter table public.attack_simulation_scenarios enable row level security;
alter table public.attack_simulation_executions enable row level security;
alter table public.attack_simulation_execution_steps enable row level security;
alter table public.attack_simulation_execution_plans enable row level security;
alter table public.attack_simulation_evidence enable row level security;
alter table public.attack_simulation_findings enable row level security;
alter table public.attack_simulation_mitigations enable row level security;
alter table public.attack_simulation_safe_fixes enable row level security;
alter table public.attack_simulation_replays enable row level security;
alter table public.attack_simulation_protection_verifications enable row level security;
alter table public.attack_simulation_runtime_events enable row level security;

create policy "Members read attack simulation campaigns"
  on public.attack_simulation_campaigns for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_campaigns.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read attack simulation scenarios"
  on public.attack_simulation_scenarios for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_scenarios.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read attack simulation executions"
  on public.attack_simulation_executions for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_executions.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read attack simulation execution steps"
  on public.attack_simulation_execution_steps for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_execution_steps.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read attack simulation execution plans"
  on public.attack_simulation_execution_plans for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_execution_plans.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read attack simulation evidence"
  on public.attack_simulation_evidence for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_evidence.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read attack simulation findings"
  on public.attack_simulation_findings for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_findings.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read attack simulation mitigations"
  on public.attack_simulation_mitigations for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_mitigations.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read attack simulation safe fixes"
  on public.attack_simulation_safe_fixes for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_safe_fixes.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read attack simulation replays"
  on public.attack_simulation_replays for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_replays.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read attack simulation protection verifications"
  on public.attack_simulation_protection_verifications for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_protection_verifications.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read attack simulation runtime events"
  on public.attack_simulation_runtime_events for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = attack_simulation_runtime_events.organization_id and m.user_id = auth.uid()
    )
  );

-- Supabase Realtime (Slice 8): add tables to publication when Realtime is enabled.
-- alter publication supabase_realtime add table public.attack_simulation_campaigns;
-- alter publication supabase_realtime add table public.attack_simulation_executions;
-- alter publication supabase_realtime add table public.attack_simulation_execution_steps;
-- alter publication supabase_realtime add table public.attack_simulation_runtime_events;

commit;

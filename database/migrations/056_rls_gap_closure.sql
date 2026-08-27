-- Enable RLS + tenant-isolation policies on tables that were missing it.
-- All 42 tables here are currently only ever queried via the service-role
-- admin client (server/**, which bypasses RLS entirely) -- confirmed by a full
-- repo audit of every .from() call site before writing this migration. Adding
-- correct org-scoped policies now is defense-in-depth with zero functional risk
-- to the current app, and matches the standard pattern already used throughout
-- (see 001_initial_schema.sql, 009_mcp_api_keys.sql): membership in
-- organization_members for the row's organization_id grants access.
--
-- attack_simulation_runtime_events is the one exception worth calling out: it IS
-- read by the browser client (useAttackCenterLive.ts, Realtime postgres_changes
-- subscription), so its policy is load-bearing, not just cosmetic.
begin;

alter table public.attack_authorizations enable row level security;
create policy "Members access org attack_authorizations" on public.attack_authorizations for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = attack_authorizations.organization_id and m.user_id = auth.uid())
);

alter table public.red_team_runs enable row level security;
create policy "Members access org red_team_runs" on public.red_team_runs for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = red_team_runs.organization_id and m.user_id = auth.uid())
);

alter table public.browser_team_runs enable row level security;
create policy "Members access org browser_team_runs" on public.browser_team_runs for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = browser_team_runs.organization_id and m.user_id = auth.uid())
);

alter table public.red_team_findings enable row level security;
create policy "Members access org red_team_findings" on public.red_team_findings for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = red_team_findings.organization_id and m.user_id = auth.uid())
);

alter table public.red_team_evidence enable row level security;
create policy "Members access org red_team_evidence" on public.red_team_evidence for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = red_team_evidence.organization_id and m.user_id = auth.uid())
);

alter table public.api_team_runs enable row level security;
create policy "Members access org api_team_runs" on public.api_team_runs for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = api_team_runs.organization_id and m.user_id = auth.uid())
);

alter table public.api_team_findings enable row level security;
create policy "Members access org api_team_findings" on public.api_team_findings for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = api_team_findings.organization_id and m.user_id = auth.uid())
);

alter table public.api_replay_plans enable row level security;
create policy "Members access org api_replay_plans" on public.api_replay_plans for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = api_replay_plans.organization_id and m.user_id = auth.uid())
);

alter table public.api_safe_fix_links enable row level security;
create policy "Members access org api_safe_fix_links" on public.api_safe_fix_links for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = api_safe_fix_links.organization_id and m.user_id = auth.uid())
);

alter table public.authorization_team_runs enable row level security;
create policy "Members access org authorization_team_runs" on public.authorization_team_runs for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = authorization_team_runs.organization_id and m.user_id = auth.uid())
);

alter table public.authorization_team_findings enable row level security;
create policy "Members access org authorization_team_findings" on public.authorization_team_findings for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = authorization_team_findings.organization_id and m.user_id = auth.uid())
);

alter table public.authorization_replay_plans enable row level security;
create policy "Members access org authorization_replay_plans" on public.authorization_replay_plans for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = authorization_replay_plans.organization_id and m.user_id = auth.uid())
);

alter table public.authorization_models enable row level security;
create policy "Members access org authorization_models" on public.authorization_models for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = authorization_models.organization_id and m.user_id = auth.uid())
);

alter table public.fix_strategies enable row level security;
create policy "Members access org fix_strategies" on public.fix_strategies for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = fix_strategies.organization_id and m.user_id = auth.uid())
);

alter table public.implementation_prompts enable row level security;
create policy "Members access org implementation_prompts" on public.implementation_prompts for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = implementation_prompts.organization_id and m.user_id = auth.uid())
);

alter table public.verification_prompts enable row level security;
create policy "Members access org verification_prompts" on public.verification_prompts for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = verification_prompts.organization_id and m.user_id = auth.uid())
);

alter table public.engineering_reports enable row level security;
create policy "Members access org engineering_reports" on public.engineering_reports for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = engineering_reports.organization_id and m.user_id = auth.uid())
);

alter table public.engineering_plans enable row level security;
create policy "Members access org engineering_plans" on public.engineering_plans for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = engineering_plans.organization_id and m.user_id = auth.uid())
);

alter table public.orchestrator_execution_plans enable row level security;
create policy "Members access org orchestrator_execution_plans" on public.orchestrator_execution_plans for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = orchestrator_execution_plans.organization_id and m.user_id = auth.uid())
);

alter table public.orchestrator_decisions enable row level security;
create policy "Members access org orchestrator_decisions" on public.orchestrator_decisions for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = orchestrator_decisions.organization_id and m.user_id = auth.uid())
);

alter table public.orchestrator_execution_history enable row level security;
create policy "Members access org orchestrator_execution_history" on public.orchestrator_execution_history for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = orchestrator_execution_history.organization_id and m.user_id = auth.uid())
);

alter table public.mission_control_sessions enable row level security;
create policy "Members access org mission_control_sessions" on public.mission_control_sessions for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = mission_control_sessions.organization_id and m.user_id = auth.uid())
);

alter table public.mission_control_feed_events enable row level security;
create policy "Members access org mission_control_feed_events" on public.mission_control_feed_events for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = mission_control_feed_events.organization_id and m.user_id = auth.uid())
);

alter table public.business_logic_runs enable row level security;
create policy "Members access org business_logic_runs" on public.business_logic_runs for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = business_logic_runs.organization_id and m.user_id = auth.uid())
);

alter table public.business_logic_run_revisions enable row level security;
create policy "Members access org business_logic_run_revisions" on public.business_logic_run_revisions for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = business_logic_run_revisions.organization_id and m.user_id = auth.uid())
);

alter table public.business_logic_workflows enable row level security;
create policy "Members access org business_logic_workflows" on public.business_logic_workflows for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = business_logic_workflows.organization_id and m.user_id = auth.uid())
);

alter table public.business_logic_state_machines enable row level security;
create policy "Members access org business_logic_state_machines" on public.business_logic_state_machines for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = business_logic_state_machines.organization_id and m.user_id = auth.uid())
);

alter table public.business_logic_invariants enable row level security;
create policy "Members access org business_logic_invariants" on public.business_logic_invariants for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = business_logic_invariants.organization_id and m.user_id = auth.uid())
);

alter table public.business_logic_abuse_cases enable row level security;
create policy "Members access org business_logic_abuse_cases" on public.business_logic_abuse_cases for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = business_logic_abuse_cases.organization_id and m.user_id = auth.uid())
);

alter table public.business_logic_specialist_results enable row level security;
create policy "Members access org business_logic_specialist_results" on public.business_logic_specialist_results for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = business_logic_specialist_results.organization_id and m.user_id = auth.uid())
);

alter table public.business_logic_runtime_results enable row level security;
create policy "Members access org business_logic_runtime_results" on public.business_logic_runtime_results for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = business_logic_runtime_results.organization_id and m.user_id = auth.uid())
);

alter table public.business_logic_findings enable row level security;
create policy "Members access org business_logic_findings" on public.business_logic_findings for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = business_logic_findings.organization_id and m.user_id = auth.uid())
);

alter table public.business_logic_replay_plans enable row level security;
create policy "Members access org business_logic_replay_plans" on public.business_logic_replay_plans for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = business_logic_replay_plans.organization_id and m.user_id = auth.uid())
);

alter table public.attack_simulation_runtime_events enable row level security;
create policy "Members access org attack_simulation_runtime_events" on public.attack_simulation_runtime_events for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = attack_simulation_runtime_events.organization_id and m.user_id = auth.uid())
);

alter table public.github_app_installations enable row level security;
create policy "Members access org github_app_installations" on public.github_app_installations for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = github_app_installations.organization_id and m.user_id = auth.uid())
);

alter table public.github_app_installation_repositories enable row level security;
create policy "Members access org github_app_installation_repositories" on public.github_app_installation_repositories for all using (
  exists (select 1 from public.organization_members m
    where m.organization_id = github_app_installation_repositories.organization_id and m.user_id = auth.uid())
);

alter table public.engineering_versions enable row level security;
create policy "Members access org engineering_versions" on public.engineering_versions for all using (
  exists (
    select 1 from public.engineering_plans p
    join public.organization_members m on m.organization_id = p.organization_id
    where p.id = engineering_versions.engineering_plan_id and m.user_id = auth.uid()
  )
);

alter table public.verification_plans enable row level security;
create policy "Members access org verification_plans" on public.verification_plans for all using (
  exists (
    select 1 from public.engineering_plans p
    join public.organization_members m on m.organization_id = p.organization_id
    where p.id = verification_plans.engineering_plan_id and m.user_id = auth.uid()
  )
);

alter table public.ai_prompts enable row level security;
create policy "Members access org ai_prompts" on public.ai_prompts for all using (
  exists (
    select 1 from public.engineering_plans p
    join public.organization_members m on m.organization_id = p.organization_id
    where p.id = ai_prompts.engineering_plan_id and m.user_id = auth.uid()
  )
);

alter table public.adapter_outputs enable row level security;
create policy "Members access org adapter_outputs" on public.adapter_outputs for all using (
  exists (
    select 1 from public.engineering_plans p
    join public.organization_members m on m.organization_id = p.organization_id
    where p.id = adapter_outputs.engineering_plan_id and m.user_id = auth.uid()
  )
);

alter table public.orchestrator_execution_graphs enable row level security;
create policy "Members access org orchestrator_execution_graphs" on public.orchestrator_execution_graphs for all using (
  exists (
    select 1 from public.orchestrator_execution_plans p
    join public.organization_members m on m.organization_id = p.organization_id
    where p.id = orchestrator_execution_graphs.execution_plan_id and m.user_id = auth.uid()
  )
);

alter table public.orchestrator_team_runs enable row level security;
create policy "Members access org orchestrator_team_runs" on public.orchestrator_team_runs for all using (
  exists (
    select 1 from public.orchestrator_execution_plans p
    join public.organization_members m on m.organization_id = p.organization_id
    where p.id = orchestrator_team_runs.execution_plan_id and m.user_id = auth.uid()
  )
);

commit;

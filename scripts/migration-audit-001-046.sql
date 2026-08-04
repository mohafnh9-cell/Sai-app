-- Migration audit: 001–046 (read-only)
-- Run in Supabase SQL Editor. Rows with status = 'MISSING' need that migration applied.
-- Order: apply migrations in numeric order; never re-run 004 on prod with data.

with checks as (
  -- 001 initial schema
  select '001' as migration, 'table: profiles' as check_name,
    to_regclass('public.profiles') is not null as ok,
    '001_initial_schema.sql' as apply_file
  union all select '001', 'table: organizations', to_regclass('public.organizations') is not null, '001_initial_schema.sql'
  union all select '001', 'table: projects', to_regclass('public.projects') is not null, '001_initial_schema.sql'

  -- 003 github tokens
  union all select '003', 'table: user_github_tokens', to_regclass('public.user_github_tokens') is not null, '003_user_github_tokens.sql'

  -- 004 scan schema (core for analysis runs)
  union all select '004', 'table: scans', to_regclass('public.scans') is not null, '004_reset_scan_schema.sql'
  union all select '004', 'table: scan_findings', to_regclass('public.scan_findings') is not null, '004_reset_scan_schema.sql'
  union all select '004', 'table: repository_scan_state', to_regclass('public.repository_scan_state') is not null, '004_reset_scan_schema.sql'

  -- 005 ai engine
  union all select '005', 'table: ai_reports', to_regclass('public.ai_reports') is not null, '005_ai_security_engine.sql'

  -- 006 github automation
  union all select '006', 'table: repository_events', to_regclass('public.repository_events') is not null, '006_github_automation.sql'

  -- 008 production readiness
  union all select '008', 'table: production_readiness_scores', to_regclass('public.production_readiness_scores') is not null, '008_production_readiness.sql'

  -- 009 mcp
  union all select '009', 'table: mcp_api_keys', to_regclass('public.mcp_api_keys') is not null, '009_mcp_api_keys.sql'

  -- 010 production verdicts (run-scoped verdicts)
  union all select '010', 'table: production_verdicts', to_regclass('public.production_verdicts') is not null, '010_production_verdicts.sql'

  -- 012 sync status
  union all select '012', 'table: repository_sync_status', to_regclass('public.repository_sync_status') is not null, '012_repository_sync_status.sql'

  -- 013 automatic reviews
  union all select '013', 'column: scans.review_type', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scans' and column_name = 'review_type'
  ), '013_automatic_production_reviews.sql'

  -- 014 autopilot
  union all select '014', 'column: organizations.verdict_autopilot_enabled', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'verdict_autopilot_enabled'
  ), '014_verdict_autopilot.sql'

  -- 019 workspace github
  union all select '019', 'table: workspace_github_connections', to_regclass('public.workspace_github_connections') is not null, '019_workspace_github_connections.sql'

  -- 020 scan jobs
  union all select '020', 'table: scan_jobs', to_regclass('public.scan_jobs') is not null, '020_scan_jobs.sql'

  -- 021 observability
  union all select '021', 'table: scan_job_events', to_regclass('public.scan_job_events') is not null, '021_scan_job_observability.sql'
  union all select '021', 'table: operation_idempotency', to_regclass('public.operation_idempotency') is not null, '021_scan_job_observability.sql'

  -- 022 production memory
  union all select '022', 'table: protection_events', to_regclass('public.protection_events') is not null, '022_production_memory.sql'

  -- 023 continuous protection
  union all select '023', 'table: project_continuous_protection', to_regclass('public.project_continuous_protection') is not null, '023_continuous_protection.sql'

  -- 024 alerts
  union all select '024', 'table: security_alerts', to_regclass('public.security_alerts') is not null, '024_security_alerts.sql'

  -- 025 reports
  union all select '025', 'table: protection_reports', to_regclass('public.protection_reports') is not null, '025_protection_reports.sql'

  -- 026 safe fix v2
  union all select '026', 'table: safe_fix_records', to_regclass('public.safe_fix_records') is not null, '026_safe_fix_engine_v2.sql'

  -- 029 scan timestamps
  union all select '029', 'column: scans.queued_at', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scans' and column_name = 'queued_at'
  ), '029_scan_execution_timestamps.sql'

  -- 030 red team / browser
  union all select '030', 'table: attack_authorizations', to_regclass('public.attack_authorizations') is not null, '030_red_team_browser.sql'
  union all select '030', 'table: red_team_runs', to_regclass('public.red_team_runs') is not null, '030_red_team_browser.sql'

  -- 033 api team
  union all select '033', 'table: api_team_runs', to_regclass('public.api_team_runs') is not null, '033_api_team.sql'

  -- 034 authorization team
  union all select '034', 'table: authorization_team_runs', to_regclass('public.authorization_team_runs') is not null, '034_authorization_team.sql'

  -- 036 fix strategy
  union all select '036', 'table: fix_strategies', to_regclass('public.fix_strategies') is not null, '036_fix_strategy_engine.sql'

  -- 037 engineering engine
  union all select '037', 'table: engineering_plans', to_regclass('public.engineering_plans') is not null, '037_universal_engineering_engine.sql'

  -- 038 orchestrator
  union all select '038', 'table: orchestrator_execution_plans', to_regclass('public.orchestrator_execution_plans') is not null, '038_autonomous_security_orchestrator.sql'

  -- 039 mission control (required before 045)
  union all select '039', 'table: mission_control_sessions', to_regclass('public.mission_control_sessions') is not null, '039_mission_control.sql'
  union all select '039', 'table: mission_control_feed_events', to_regclass('public.mission_control_feed_events') is not null, '039_mission_control.sql'

  -- 040 business logic
  union all select '040', 'table: business_logic_runs', to_regclass('public.business_logic_runs') is not null, '040_business_logic.sql'

  -- 041 review cancellation
  union all select '041', 'column: scans.cancelled_at', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scans' and column_name = 'cancelled_at'
  ), '041_review_cancellation.sql'

  -- 042 attack simulation engine (Attack Center run scoping)
  union all select '042', 'table: attack_simulation_campaigns', to_regclass('public.attack_simulation_campaigns') is not null, '042_attack_simulation_engine.sql'

  -- 043 realtime (optional marker: campaigns in publication)
  union all select '043', 'realtime: attack_simulation_campaigns', exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attack_simulation_campaigns'
  ), '043_attack_simulation_realtime.sql'

  -- 044 analysis run indexes
  union all select '044', 'index: idx_scans_project_org_status_completed', exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_scans_project_org_status_completed'
  ), '044_analysis_run_indexes.sql'

  -- 045 analysis run immutability
  union all select '045', 'column: scans.immutability_locked_at', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scans' and column_name = 'immutability_locked_at'
  ), '045_analysis_run_immutability.sql'
  union all select '045', 'column: mission_control_feed_events.scan_id', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mission_control_feed_events' and column_name = 'scan_id'
  ), '045_analysis_run_immutability.sql'
  union all select '045', 'column: mission_control_sessions.scan_id', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mission_control_sessions' and column_name = 'scan_id'
  ), '045_analysis_run_immutability.sql'
  union all select '045', 'trigger: trg_scans_immutability_lock', exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'scans' and t.tgname = 'trg_scans_immutability_lock' and not t.tgisinternal
  ), '045_analysis_run_immutability.sql'

  -- 046 hard immutability guard
  union all select '046', 'function: prevent_immutable_scan_core_mutation', exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'prevent_immutable_scan_core_mutation'
  ), '046_analysis_run_immutable_core_guard.sql'
  union all select '046', 'trigger: trg_scans_prevent_immutable_core', exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'scans' and t.tgname = 'trg_scans_prevent_immutable_core' and not t.tgisinternal
  ), '046_analysis_run_immutable_core_guard.sql'
)
select
  migration,
  check_name,
  case when ok then 'OK' else 'MISSING' end as status,
  case when ok then null else apply_file end as apply_when_missing
from checks
order by migration, check_name;

-- Summary: first missing migration in numeric order (run after main query)
-- select min(migration) as first_gap from (...checks...) where not ok;

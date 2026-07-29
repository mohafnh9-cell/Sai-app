-- Production Review / scan_jobs preflight (read-only).
-- Run in Supabase SQL Editor before applying migrations 020 → 021 → 041.
-- Does not mutate data.

-- 1) Core objects
select
  to_regclass('public.scan_jobs') is not null as scan_jobs_exists,
  to_regclass('public.scan_job_events') is not null as scan_job_events_exists,
  to_regclass('public.operation_idempotency') is not null as operation_idempotency_exists;

-- 2) scan_jobs columns (020 + 021)
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'scan_jobs'
  and column_name in (
    'id', 'organization_id', 'project_id', 'scan_id', 'github_delivery_id',
    'job_type', 'status', 'failure_code', 'failure_message', 'metadata',
    'scheduled_at', 'started_at', 'completed_at', 'failed_at', 'cancelled_at',
    'heartbeat_at', 'execution_deadline_at', 'locked_at', 'locked_by',
    'queue_wait_ms', 'duration_ms'
  )
order by column_name;

-- 3) Indexes on scan_jobs
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'scan_jobs'
order by indexname;

-- 4) Status / job_type constraints (allowed values)
select
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'scan_jobs'
  and con.contype = 'c';

-- 5) Cancellation columns on scans (041)
select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'scans'
  and column_name in (
    'cancelled_at', 'cancelled_by', 'cancellation_reason',
    'progress_at_cancellation', 'last_completed_phase', 'commit_sha'
  )
order by column_name;

-- 6) scans.status check includes intermediate + terminal states (041)
select
  con.conname,
  pg_get_constraintdef(con.oid) as scans_status_check
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'scans'
  and con.conname = 'scans_status_check';

-- 7) production_verdicts linkage (project-scoped current verdict)
select
  to_regclass('public.production_verdicts') is not null as production_verdicts_exists,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'production_verdicts'
      and column_name in ('scan_id', 'commit_sha', 'project_id')
  ) as production_verdicts_has_scan_and_commit;

-- 8) RLS enabled (service role bypasses; members need SELECT policy)
select
  relname as table_name,
  relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('scan_jobs', 'scan_job_events', 'operation_idempotency');

-- Manual apply order (do not skip):
--   1. database/migrations/020_scan_jobs.sql
--   2. database/migrations/021_scan_job_observability.sql
--   3. database/migrations/041_review_cancellation.sql
-- Optional performance indexes if present in repo: 027_* (after 021).
-- Rollback: dropping scan_jobs cascades events; scans rows remain. Not recommended on production.

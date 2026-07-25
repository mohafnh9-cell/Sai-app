-- Phase 1.6 migration preflight for 020_scan_jobs.sql + 021_scan_job_observability.sql
-- Run in Supabase SQL editor or psql after applying migrations.
-- Each row should return ok = true.

-- 1. Core tables
select 'scan_jobs' as check_name, to_regclass('public.scan_jobs') is not null as ok
union all
select 'scan_job_events', to_regclass('public.scan_job_events') is not null
union all
select 'operation_idempotency', to_regclass('public.operation_idempotency') is not null;

-- 2. Recovery / observability columns on scan_jobs
select 'recovery_columns' as check_name,
  count(*) = 9 as ok
from information_schema.columns
where table_schema = 'public' and table_name = 'scan_jobs'
  and column_name in (
    'heartbeat_at','execution_deadline_at','last_recovery_at',
    'recovery_attempts','max_recovery_attempts','locked_at','locked_by',
    'queue_wait_ms','duration_ms'
  );

-- 3. Partial unique indexes (idempotency)
select indexname as check_name, true as ok
from pg_indexes
where schemaname = 'public' and tablename = 'scan_jobs'
  and indexname in ('idx_scan_jobs_webhook_delivery','idx_scan_jobs_active_scan','idx_scan_jobs_stuck_recovery');

-- 4. Event and idempotency indexes
select indexname as check_name, true as ok
from pg_indexes
where schemaname = 'public'
  and (
    (tablename = 'scan_job_events' and indexname like 'idx_scan_job_events_%')
    or (tablename = 'operation_idempotency' and indexname = 'idx_operation_idempotency_org_type')
  );

-- 5. Foreign keys on scan_job_events
select conname as check_name, true as ok
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid = 'public.scan_job_events'::regclass
  and contype = 'f';

-- 6. RLS enabled
select c.relname as check_name, c.relrowsecurity as ok
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('scan_jobs','scan_job_events','operation_idempotency');

-- 7. RLS policies
select tablename || ':' || policyname as check_name, true as ok
from pg_policies
where schemaname = 'public'
  and tablename in ('scan_jobs','scan_job_events','operation_idempotency');

-- 8. Idempotency uniqueness (primary key on idempotency_key)
select 'operation_idempotency_pk' as check_name,
  exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'operation_idempotency'
      and constraint_type = 'PRIMARY KEY'
  ) as ok;

-- 9. Safe re-run sanity (021 uses IF NOT EXISTS — no duplicate index names)
select indexname as check_name,
  count(*) = 1 as ok
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_scan_jobs_webhook_delivery','idx_scan_jobs_active_scan','idx_scan_jobs_stuck_recovery',
    'idx_scan_job_events_type_created','idx_scan_job_events_org_created','idx_scan_job_events_job_created',
    'idx_operation_idempotency_org_type'
  )
group by indexname;

-- 10. Recovery column defaults
select column_name as check_name, column_default is not null as ok
from information_schema.columns
where table_schema = 'public' and table_name = 'scan_jobs'
  and column_name in ('recovery_attempts','max_recovery_attempts','status');

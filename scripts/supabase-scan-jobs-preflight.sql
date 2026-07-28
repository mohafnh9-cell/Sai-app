-- Run in Supabase SQL Editor if Production Reviews fail with:
-- "Could not find the table public.scan_jobs in the schema cache"
--
-- Prefer: npm run db:apply-migrations 020 021 027 041
-- Or paste the contents of database/migrations/020_scan_jobs.sql and 021_scan_job_observability.sql

select
  to_regclass('public.scan_jobs') is not null as scan_jobs_exists,
  to_regclass('public.scan_job_events') is not null as scan_job_events_exists;

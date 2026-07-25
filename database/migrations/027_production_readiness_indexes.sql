-- Sprint 8: Production readiness — query performance indexes (no behaviour change)
begin;

create index if not exists idx_protection_events_project_type_time
  on public.protection_events (project_id, type, occurred_at desc);

create index if not exists idx_security_alerts_project_state_created
  on public.security_alerts (project_id, state, created_at desc);

create index if not exists idx_safe_fix_records_project_state_created
  on public.safe_fix_records (project_id, lifecycle_state, created_at desc);

create index if not exists idx_protection_reports_project_type_period
  on public.protection_reports (project_id, report_type, period_start desc)
  where is_current = true;

create index if not exists idx_scan_jobs_org_status_updated
  on public.scan_jobs (organization_id, status, updated_at desc);

create index if not exists idx_scan_job_events_type_created
  on public.scan_job_events (event_type, created_at desc);

create index if not exists idx_protection_recommendations_project_status
  on public.protection_recommendations (project_id, status);

commit;

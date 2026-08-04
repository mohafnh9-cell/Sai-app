-- Sprint 1: Analysis run read-path — resolver query performance (no behaviour change)
begin;

create index if not exists idx_scans_project_org_status_completed
  on public.scans (project_id, organization_id, status, completed_at desc);

create index if not exists idx_scans_project_org_status_created
  on public.scans (project_id, organization_id, status, created_at desc);

commit;

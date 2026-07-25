-- Phase 1: durable scan job tracking for async orchestration (Inngest)
begin;

create table if not exists public.scan_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  scan_id uuid references public.scans(id) on delete set null,
  github_delivery_id text,
  job_type text not null check (
    job_type in (
      'webhook_process',
      'manual_scan',
      'mcp_review',
      'webhook_push_scan',
      'webhook_pr_scan',
      'automatic_review'
    )
  ),
  status text not null default 'queued' check (
    status in ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  failure_code text,
  failure_message text,
  inngest_run_id text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  metadata jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One ingress job per GitHub delivery (webhook ack path)
create unique index if not exists idx_scan_jobs_webhook_delivery
  on public.scan_jobs (github_delivery_id)
  where job_type = 'webhook_process' and github_delivery_id is not null;

-- Prevent duplicate active scan jobs for the same scan
create unique index if not exists idx_scan_jobs_active_scan
  on public.scan_jobs (scan_id)
  where scan_id is not null and status in ('queued', 'running');

create index if not exists idx_scan_jobs_org_status
  on public.scan_jobs (organization_id, status, created_at desc);

create index if not exists idx_scan_jobs_project_status
  on public.scan_jobs (project_id, status, created_at desc)
  where project_id is not null;

alter table public.scan_jobs enable row level security;

drop policy if exists "Members read scan jobs" on public.scan_jobs;
create policy "Members read scan jobs" on public.scan_jobs for select using (
  exists (
    select 1 from public.organization_members m
    where m.organization_id = scan_jobs.organization_id and m.user_id = auth.uid()
  )
);

commit;

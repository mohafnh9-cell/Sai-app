-- Phase D: GitHub App migration groundwork + PR security linkage
begin;

alter table public.workspace_github_connections
  add column if not exists github_auth_mode text not null default 'oauth_legacy'
    check (github_auth_mode in ('oauth_legacy', 'github_app'));

create table if not exists public.github_app_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  github_installation_id bigint not null,
  github_account_id bigint not null,
  github_account_login text not null,
  github_account_type text not null
    check (github_account_type in ('User', 'Organization')),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked')),
  permissions_snapshot jsonb not null default '{}'::jsonb,
  repository_selection text,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, github_installation_id)
);

create index if not exists github_app_installations_org_idx
  on public.github_app_installations (organization_id);

alter table public.pull_request_scans
  add column if not exists production_verdict_id uuid references public.production_verdicts(id) on delete set null,
  add column if not exists github_check_run_id bigint,
  add column if not exists verdict_status text;

create index if not exists pull_request_scans_project_pr_updated_idx
  on public.pull_request_scans (project_id, pull_request_number, updated_at desc);

commit;

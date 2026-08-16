-- Phase D.3: GitHub App installation security + project auth mode
begin;

alter table public.github_app_installations
  add column if not exists revoked_at timestamptz;

create table if not exists public.github_app_installation_repositories (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.github_app_installations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  github_repository_id bigint not null,
  github_full_name text,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (installation_id, github_repository_id)
);

create index if not exists github_app_installation_repos_org_repo_idx
  on public.github_app_installation_repositories (organization_id, github_repository_id)
  where removed_at is null;

alter table public.projects
  add column if not exists github_auth_mode text
    check (github_auth_mode is null or github_auth_mode in ('oauth_legacy', 'github_app')),
  add column if not exists github_app_installation_id uuid
    references public.github_app_installations(id) on delete set null;

create index if not exists projects_github_app_installation_idx
  on public.projects (github_app_installation_id)
  where github_app_installation_id is not null;

commit;

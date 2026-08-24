-- Shared read cache for the org Brain snapshot (buildOrgBrain), replacing the
-- in-process Map cache that never hit across serverless instances.
begin;

create table if not exists public.org_brain_cache (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  payload jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_org_brain_cache_expires on public.org_brain_cache (expires_at);

-- Service-role only: no end-user read path needs this table directly.
alter table public.org_brain_cache enable row level security;

commit;

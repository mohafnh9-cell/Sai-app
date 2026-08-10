-- Domain ownership verification before dynamic target authorization (preview/staging only).

create table if not exists public.dynamic_target_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  target_origin text not null,
  verification_token text not null,
  verification_method text not null check (verification_method in ('http', 'dns')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'expired')),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dynamic_target_verifications_tenant_fk'
      and conrelid = 'public.dynamic_target_verifications'::regclass
  ) then
    alter table public.dynamic_target_verifications
      add constraint dynamic_target_verifications_tenant_fk
      foreign key (project_id, organization_id)
      references public.projects (id, organization_id)
      on delete cascade;
  end if;
end
$$;

create unique index if not exists idx_dynamic_target_verifications_active
  on public.dynamic_target_verifications (project_id, target_origin)
  where status in ('pending', 'verified');

create index if not exists idx_dynamic_target_verifications_project_status
  on public.dynamic_target_verifications (project_id, status, expires_at desc);

-- Row level security: organization members may read verification state for
-- projects in their organization. Writes remain service-role only because no
-- authenticated or anonymous write policy is defined.
alter table public.dynamic_target_verifications enable row level security;

drop policy if exists "Members read dynamic target verifications"
  on public.dynamic_target_verifications;
create policy "Members read dynamic target verifications"
  on public.dynamic_target_verifications for select
  using (
    exists (
      select 1
      from public.organization_members m
      where m.organization_id = dynamic_target_verifications.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.projects p
      where p.id = dynamic_target_verifications.project_id
        and p.organization_id = dynamic_target_verifications.organization_id
    )
  );

drop trigger if exists set_dynamic_target_verifications_updated_at
  on public.dynamic_target_verifications;
create trigger set_dynamic_target_verifications_updated_at
  before update on public.dynamic_target_verifications
  for each row execute function public.set_updated_at();

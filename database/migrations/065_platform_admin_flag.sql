-- Internal SequrAI platform-admin designation: unlimited product access for
-- development, testing, and operating SequrAI -- separate from both
-- organization role (OWNER/ADMIN/MEMBER, permission level within a single
-- customer org) and plan (FREE/PRO, the org's billing tier). A platform
-- admin never has a fake "PRO" plan or Stripe subscription created for them;
-- server/billing/platform-admin.ts checks this flag directly and, when set,
-- overrides the entitlement decision to unlimited without touching billing
-- state at all.
begin;

alter table public.profiles
  add column if not exists is_platform_admin boolean not null default false;

-- Defense in depth: the existing "Users can update their own profile" RLS
-- policy (migration 001) has no column restriction, so without this trigger
-- any authenticated user could grant themselves unlimited access with a
-- plain client-side `.update({ is_platform_admin: true })` call. This
-- trigger silently reverts any change to the column unless the request runs
-- as the service role (i.e. the trusted server-side admin client) --
-- ordinary profile edits (name, avatar) are unaffected.
create or replace function public.protect_platform_admin_flag()
returns trigger
language plpgsql
as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin then
    if coalesce(auth.role(), '') <> 'service_role' then
      new.is_platform_admin := old.is_platform_admin;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_platform_admin on public.profiles;

create trigger trg_profiles_protect_platform_admin
  before update on public.profiles
  for each row
  execute function public.protect_platform_admin_flag();

commit;

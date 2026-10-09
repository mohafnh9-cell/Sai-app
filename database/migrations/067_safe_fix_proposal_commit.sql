-- Safe Fix: bind a proposal to the commit that contains its change.
--
-- NOT applied automatically. Review, then apply in numeric order like every other migration.
-- Additive and nullable: existing (documentary) records keep NULL and keep the assisted flow;
-- no SHA is invented for them. Safe to apply before or after the code that reads it (the code
-- treats a missing column value as NULL).
--
-- RLS review (026): safe_fix_records / safe_fix_lifecycle_events / safe_fix_verifications have RLS
-- enabled with member-SELECT policies only; there are no INSERT/UPDATE/DELETE policies, so writes are
-- possible only through the service role. Tenant consistency is enforced by the composite
-- (project_id, organization_id) foreign key. This migration changes none of that.
begin;

alter table public.safe_fix_records
  add column if not exists proposal_commit_sha text
    check (proposal_commit_sha is null or proposal_commit_sha ~ '^[0-9a-f]{40}$');

comment on column public.safe_fix_records.proposal_commit_sha is
  'Full SHA of the commit containing the proposed change. NULL = documentary proposal (no commit of its own). Distinct from the base commit (commit of review_id scan).';

commit;

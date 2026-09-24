-- PASS 5.6A: an active full review is unique per (repository, branch), not per repository.
--
-- Before: idx_scans_one_active_full_per_repository (repository_id) allowed a single
-- active full scan for the whole repository, so a feature-branch review and a
-- default-branch review could not both be active (one swallowed or killed the other).
--
-- After: uniqueness is per (repository_id, coalesce(branch, '')). A NULL branch is its
-- own scope ('') -- the application normalises GitHub-connected scans to a resolved
-- branch name, and NULL only remains for branchless sources (uploads).
--
-- Preflight (run first; must return 0 rows -- it always does, because the old index was
-- stricter than the new one):
--   select repository_id, coalesce(branch, ''), count(*) from public.scans
--   where scan_type = 'full'
--     and status in ('queued','fetching_repository','indexing','scanning','calculating_score','cancelling')
--   group by 1, 2 having count(*) > 1;
--
-- No rows are updated or deleted. Historical scans and verdicts are untouched.
--
-- Rollback (only valid when no two branches have an active full scan at the same time):
--   drop index if exists public.idx_scans_one_active_full_per_repository_branch;
--   create unique index idx_scans_one_active_full_per_repository
--     on public.scans (repository_id)
--     where scan_type = 'full'
--       and status in ('queued','fetching_repository','indexing','scanning','calculating_score','cancelling');

begin;

create unique index if not exists idx_scans_one_active_full_per_repository_branch
  on public.scans (repository_id, (coalesce(branch, '')))
  where scan_type = 'full'
    and status in (
      'queued', 'fetching_repository', 'indexing', 'scanning',
      'calculating_score', 'cancelling'
    );

drop index if exists public.idx_scans_one_active_full_per_repository;

commit;

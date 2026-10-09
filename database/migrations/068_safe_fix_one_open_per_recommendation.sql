-- Safe Fix: at most ONE open correction per (project, recommendation).
--
-- NOT applied automatically. The application is already safe without it (idempotent reuse, in-flight protection, and a
-- deterministic reconcile after concurrent inserts); this index makes the guarantee strict at the database, so two
-- simultaneous requests cannot both leave an open proposal.
--
-- Open states = PROPOSED, READY, APPROVED, APPLIED, VERIFYING. Terminal states (VERIFIED, FAILED, SUPERSEDED) may repeat.
--
-- Precheck: if duplicates already exist the index cannot be built, and we must not silently choose which one to drop.
-- The migration stops with the offending (project, recommendation) pairs so a person can resolve them first.
begin;

do $$
declare dup text;
begin
  select string_agg(project_id::text || '/' || recommendation_id || ' x' || n, ', ')
    into dup
    from (
      select project_id, recommendation_id, count(*) as n
        from public.safe_fix_records
       where lifecycle_state in ('PROPOSED','READY','APPROVED','APPLIED','VERIFYING')
       group by project_id, recommendation_id
      having count(*) > 1
    ) d;
  if dup is not null then
    raise exception 'safe_fix_records has several open corrections for the same recommendation: %. Resolve them (supersede all but one) and re-run.', dup;
  end if;
end $$;

create unique index if not exists uq_safe_fix_one_open_per_recommendation
  on public.safe_fix_records (project_id, recommendation_id)
  where lifecycle_state in ('PROPOSED','READY','APPROVED','APPLIED','VERIFYING');

commit;

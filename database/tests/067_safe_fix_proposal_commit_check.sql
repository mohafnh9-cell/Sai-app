-- Reproducible check of migration 067 against a REAL PostgreSQL, in the two deployment orders.
-- Run it with scripts/db-check-067.sh (throwaway local cluster) or against any disposable database that
-- already has migrations 001-066 applied and 067 NOT applied. It never touches data it did not create.
--
-- Output: one line per check, "PASS ..." / "FAIL ...". A FAIL aborts with a non-zero exit.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if;
end $$;

-- ---------- fixtures (ids are fixed; leftovers of an aborted earlier run are removed first) ----------
begin;
delete from public.safe_fix_records where organization_id in ('10000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000b1');
delete from public.projects where organization_id in ('10000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000b1');
delete from public.organization_members where organization_id in ('10000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000b1');
delete from public.organizations where id in ('10000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000b1');
delete from auth.users where id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1','member@a.test'),
  ('00000000-0000-4000-8000-0000000000b1','member@b.test') on conflict do nothing;
insert into public.organizations (id, name, slug) values
  ('10000000-0000-4000-8000-0000000000a1','Org A','chk067-a'),
  ('10000000-0000-4000-8000-0000000000b1','Org B','chk067-b') on conflict do nothing;
insert into public.organization_members (organization_id, user_id) values
  ('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1'),
  ('10000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b1') on conflict do nothing;
insert into public.projects (id, organization_id, name) values
  ('20000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000a1','proj a'),
  ('20000000-0000-4000-8000-0000000000a2','10000000-0000-4000-8000-0000000000a1','proj a2'),
  ('20000000-0000-4000-8000-0000000000b1','10000000-0000-4000-8000-0000000000b1','proj b') on conflict do nothing;
-- Records created BEFORE migration 067 (documentary proposals, one already verified).
insert into public.safe_fix_records (id, organization_id, project_id, recommendation_id, confidence_band, confidence_score, lifecycle_state) values
  ('30000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a1','rec-old-ready','HIGH',80,'READY'),
  ('30000000-0000-4000-8000-0000000000a2','10000000-0000-4000-8000-0000000000a1','20000000-0000-4000-8000-0000000000a1','rec-old-verified','HIGH',80,'VERIFIED'),
  ('30000000-0000-4000-8000-0000000000b1','10000000-0000-4000-8000-0000000000b1','20000000-0000-4000-8000-0000000000b1','rec-b','HIGH',80,'READY');
commit;

-- ---------- BEFORE 067: what the deployed code meets ----------
do $$
declare ok boolean;
begin
  perform pg_temp.check('before: column absent', not exists (select 1 from information_schema.columns where table_name='safe_fix_records' and column_name='proposal_commit_sha'));
  perform pg_temp.check('before: select * works (code reads records as unbound)', (select count(*) from public.safe_fix_records) >= 3);

  begin perform proposal_commit_sha from public.safe_fix_records limit 1; ok := false;
  exception when undefined_column then ok := true; end;
  perform pg_temp.check('before: selecting the column fails with 42703 undefined_column (code maps this to proposal_commit_unsupported)', ok);

  begin execute 'update public.safe_fix_records set proposal_commit_sha = ''x'' where false'; ok := false;
  exception when undefined_column then ok := true; end;
  perform pg_temp.check('before: writing the column fails with 42703 (PostgREST: PGRST204)', ok);
end $$;

-- ---------- APPLY 067 (the real file) ----------
\i database/migrations/067_safe_fix_proposal_commit.sql

-- ---------- AFTER 067 ----------
do $$
declare ok boolean; n int; sha text := repeat('b',40);
begin
  perform pg_temp.check('after: column exists, nullable text',
    exists (select 1 from information_schema.columns where table_name='safe_fix_records' and column_name='proposal_commit_sha' and is_nullable='YES' and data_type='text'));
  perform pg_temp.check('after: records created before 067 keep NULL (documentary / unbound) and their state',
    (select count(*) from public.safe_fix_records where id in ('30000000-0000-4000-8000-0000000000a1','30000000-0000-4000-8000-0000000000a2') and proposal_commit_sha is null) = 2
    and (select lifecycle_state from public.safe_fix_records where id='30000000-0000-4000-8000-0000000000a2') = 'VERIFIED');

  -- the exact guarded write the code issues (first commit: current NULL)
  update public.safe_fix_records set proposal_commit_sha = sha, updated_at = now()
   where id='30000000-0000-4000-8000-0000000000a1' and organization_id='10000000-0000-4000-8000-0000000000a1'
     and project_id='20000000-0000-4000-8000-0000000000a1' and proposal_commit_sha is null;
  get diagnostics n = row_count;
  perform pg_temp.check('after: guarded first write (is null) updates exactly 1 row', n = 1);

  update public.safe_fix_records set proposal_commit_sha = repeat('c',40)
   where id='30000000-0000-4000-8000-0000000000a1' and organization_id='10000000-0000-4000-8000-0000000000a1'
     and project_id='20000000-0000-4000-8000-0000000000a1' and proposal_commit_sha is null;
  get diagnostics n = row_count;
  perform pg_temp.check('after: a second writer with the stale expectation (is null) updates 0 rows -> proposal_commit_conflict', n = 0);

  update public.safe_fix_records set proposal_commit_sha = repeat('c',40)
   where id='30000000-0000-4000-8000-0000000000a1' and organization_id='10000000-0000-4000-8000-0000000000a1'
     and project_id='20000000-0000-4000-8000-0000000000a1' and proposal_commit_sha = sha;
  get diagnostics n = row_count;
  perform pg_temp.check('after: guarded change (eq old) updates 1 row', n = 1);

  update public.safe_fix_records set proposal_commit_sha = sha
   where id='30000000-0000-4000-8000-0000000000b1' and organization_id='10000000-0000-4000-8000-0000000000a1'
     and project_id='20000000-0000-4000-8000-0000000000a1' and proposal_commit_sha is null;
  get diagnostics n = row_count;
  perform pg_temp.check('after: a write scoped to the wrong organization/project touches 0 rows', n = 0);

  foreach sha in array array['abc123', repeat('B',40), repeat('b',39), repeat('g',40)] loop
    begin update public.safe_fix_records set proposal_commit_sha = sha where id='30000000-0000-4000-8000-0000000000a1'; ok := false;
    exception when check_violation then ok := true; end;
    perform pg_temp.check('after: malformed SHA rejected by the CHECK: ' || sha, ok);
  end loop;

  begin update public.safe_fix_records set proposal_commit_sha = null where id='30000000-0000-4000-8000-0000000000a1'; ok := true;
  exception when others then ok := false; end;
  perform pg_temp.check('after: NULL stays allowed', ok);

  begin insert into public.safe_fix_records (organization_id, project_id, recommendation_id, confidence_band, confidence_score)
        values ('10000000-0000-4000-8000-0000000000b1','20000000-0000-4000-8000-0000000000a1','x','HIGH',1); ok := false;
  exception when foreign_key_violation then ok := true; end;
  perform pg_temp.check('after: the tenant foreign key still rejects a project/organization mismatch', ok);
end $$;

-- idempotent re-application
\i database/migrations/067_safe_fix_proposal_commit.sql
select 'PASS after: migration is idempotent (second run is a no-op)';

-- ---------- RLS (026 policies, unchanged): members read their organization only; no authenticated writes ----------
-- Supabase grants table privileges to `authenticated` by default and relies on RLS; reproduce that so the policies decide.
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
do $$
declare n int; ok boolean;
begin
  select count(*) into n from public.safe_fix_records;
  perform pg_temp.check('rls: member of org A sees only org A records (incl. the new column)', n = 2 and not exists (select 1 from public.safe_fix_records where organization_id <> '10000000-0000-4000-8000-0000000000a1'));
  update public.safe_fix_records set proposal_commit_sha = repeat('d',40) where id='30000000-0000-4000-8000-0000000000a2';
  get diagnostics n = row_count;
  perform pg_temp.check('rls: an authenticated user cannot write (no UPDATE policy) -> 0 rows', n = 0);
end $$;
reset role;

-- ---------- recovery: dropping the column is non-destructive for the records ----------
begin;
alter table public.safe_fix_records drop column proposal_commit_sha;
select 'PASS rollback: column dropped, records intact (' || count(*) || ' records)' from public.safe_fix_records where organization_id in ('10000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000b1');
rollback;  -- keep the column for the final state check
select 'PASS rollback rehearsed inside a transaction and rolled back';

-- ---------- cleanup of the fixtures this script created ----------
delete from public.safe_fix_records where organization_id in ('10000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000b1');
delete from public.projects where organization_id in ('10000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000b1');
delete from public.organization_members where organization_id in ('10000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000b1');
delete from public.organizations where id in ('10000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000b1');
delete from auth.users where id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1');

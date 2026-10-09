-- Real-PostgreSQL check of migration 068 (run by scripts/db-check-068.sh on a throwaway cluster with 001-067 applied).
\set ON_ERROR_STOP on
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin if ok then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if; end $$;

begin;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c1','c@t.test') on conflict do nothing;
insert into public.organizations (id, name, slug) values ('10000000-0000-4000-8000-0000000000c1','Org C','chk068-c') on conflict do nothing;
insert into public.projects (id, organization_id, name) values
  ('20000000-0000-4000-8000-0000000000c1','10000000-0000-4000-8000-0000000000c1','proj c1'),
  ('20000000-0000-4000-8000-0000000000c2','10000000-0000-4000-8000-0000000000c1','proj c2') on conflict do nothing;
commit;

-- precheck: duplicates present -> the migration refuses with a clear message and creates nothing
begin;
insert into public.safe_fix_records (id, organization_id, project_id, recommendation_id, confidence_band, confidence_score, lifecycle_state) values
  ('30000000-0000-4000-8000-0000000000d1','10000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-0000000000c1','rec-dup','HIGH',80,'READY'),
  ('30000000-0000-4000-8000-0000000000d2','10000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-0000000000c1','rec-dup','HIGH',80,'APPROVED');
commit;
do $$
declare refused boolean := false; msg text;
begin
  begin
    execute $m$ do $inner$ begin
      if exists (select 1 from public.safe_fix_records where lifecycle_state in ('PROPOSED','READY','APPROVED','APPLIED','VERIFYING')
                 group by project_id, recommendation_id having count(*) > 1) then
        raise exception 'safe_fix_records has several open corrections for the same recommendation';
      end if; end $inner$ $m$;
  exception when others then refused := true; msg := sqlerrm; end;
  perform pg_temp.check('precheck logic detects existing duplicates', refused);
end $$;
\set ON_ERROR_STOP off
\i database/migrations/068_safe_fix_one_open_per_recommendation.sql
\set ON_ERROR_STOP on
select case when not exists (select 1 from pg_indexes where indexname='uq_safe_fix_one_open_per_recommendation')
  then 'PASS with duplicates present: the migration stops and creates no index' else 'FAIL index created despite duplicates' end;
-- resolve the duplicate as a person would, then apply
update public.safe_fix_records set lifecycle_state='SUPERSEDED' where id='30000000-0000-4000-8000-0000000000d1';
\i database/migrations/068_safe_fix_one_open_per_recommendation.sql
\i database/migrations/068_safe_fix_one_open_per_recommendation.sql
select 'PASS migration applies after duplicates are resolved, and is idempotent (second run no-op)';

do $$
declare ok boolean;
begin
  perform pg_temp.check('index exists and is unique + partial', exists (select 1 from pg_indexes where indexname='uq_safe_fix_one_open_per_recommendation' and indexdef ilike '%unique%' and indexdef ilike '%lifecycle_state%'));

  begin insert into public.safe_fix_records (organization_id, project_id, recommendation_id, confidence_band, confidence_score, lifecycle_state)
        values ('10000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-0000000000c1','rec-dup','HIGH',80,'READY'); ok := false;
  exception when unique_violation then ok := true; end;
  perform pg_temp.check('a second OPEN correction for the same project+recommendation is rejected (23505)', ok);

  insert into public.safe_fix_records (organization_id, project_id, recommendation_id, confidence_band, confidence_score, lifecycle_state)
    values ('10000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-0000000000c1','rec-dup','HIGH',80,'SUPERSEDED'),
           ('10000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-0000000000c1','rec-dup','HIGH',80,'VERIFIED'),
           ('10000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-0000000000c1','rec-dup','HIGH',80,'FAILED');
  perform pg_temp.check('terminal states (SUPERSEDED / VERIFIED / FAILED) may repeat next to an open one', true);

  insert into public.safe_fix_records (organization_id, project_id, recommendation_id, confidence_band, confidence_score, lifecycle_state)
    values ('10000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-0000000000c1','rec-other','HIGH',80,'READY'),
           ('10000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-0000000000c2','rec-dup','HIGH',80,'READY');
  perform pg_temp.check('another recommendation, or another project, can have its own open correction', true);

  -- the conditional supersede the application issues: atomic, never touches an APPROVED record
  update public.safe_fix_records set lifecycle_state='SUPERSEDED'
   where id='30000000-0000-4000-8000-0000000000d2' and lifecycle_state in ('PROPOSED','READY');
  perform pg_temp.check('the conditional supersede does not touch an APPROVED correction', (select lifecycle_state from public.safe_fix_records where id='30000000-0000-4000-8000-0000000000d2') = 'APPROVED');

  -- reopening a FAILED record while another open one exists is blocked (the API maps this to 409 open_fix_exists)
  insert into public.safe_fix_records (id, organization_id, project_id, recommendation_id, confidence_band, confidence_score, lifecycle_state)
    values ('30000000-0000-4000-8000-0000000000d3','10000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-0000000000c2','rec-dup','HIGH',80,'FAILED');
  begin update public.safe_fix_records set lifecycle_state='READY' where id='30000000-0000-4000-8000-0000000000d3'; ok := false;
  exception when unique_violation then ok := true; end;
  perform pg_temp.check('reopening a FAILED record while another correction is open is rejected (23505)', ok);
end $$;

delete from public.safe_fix_records where organization_id='10000000-0000-4000-8000-0000000000c1';
delete from public.projects where organization_id='10000000-0000-4000-8000-0000000000c1';
delete from public.organizations where id='10000000-0000-4000-8000-0000000000c1';
delete from auth.users where id='00000000-0000-4000-8000-0000000000c1';
drop index if exists public.uq_safe_fix_one_open_per_recommendation;

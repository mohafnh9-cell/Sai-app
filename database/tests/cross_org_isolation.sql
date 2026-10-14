-- Cross-organization isolation on a throwaway PostgreSQL with the REAL migrations and RLS policies.
-- Two organizations (A and B), one member each. For EVERY table that carries `organization_id` (or, failing that, `project_id`) it seeds one row
-- per organization, then acts as user B (role `authenticated`, JWT sub = B) and as `anon` against organization A's rows:
--   read   -> must see 0 rows of A
--   update -> must change 0 rows of A        delete -> must change 0 rows of A
--   insert -> an insert that WOULD succeed for A as superuser must be refused with SQLSTATE 42501 (insufficient privilege / RLS)
-- and it reports how many tables could be seeded at all: a table that cannot be seeded generically is listed as NOT COVERED, never as passed.
-- Output lines: PASS ... / FAIL ... / NOTE ... / SUMMARY ...
\set ON_ERROR_STOP on
set client_min_messages = notice;
grant usage on schema public to authenticated, anon;
grant all on all tables in schema public to authenticated, anon;
alter default privileges in schema public grant all on tables to authenticated, anon;

create schema iso;
grant usage on schema iso to authenticated, anon;
create temp table iso_cases (tbl text primary key, scope_col text not null, seed_a text, seeded boolean not null default false, skip_reason text, rls_on boolean not null);
grant all on iso_cases to authenticated, anon;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1','a@iso.test'), ('00000000-0000-4000-8000-0000000000b1','b@iso.test');
insert into public.organizations (id, name, slug) values ('10000000-0000-4000-8000-0000000000a1','Org A','iso-a'), ('10000000-0000-4000-8000-0000000000b1','Org B','iso-b');
insert into public.organization_members (organization_id, user_id) values ('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1'), ('10000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b1');
insert into public.projects (id, organization_id, name) values ('20000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000a1','proj-a'), ('20000000-0000-4000-8000-0000000000b1','10000000-0000-4000-8000-0000000000b1','proj-b');

create function iso.lit(col text, typ text, udt text, org uuid, proj uuid, usr uuid, ov jsonb) returns text language plpgsql as $$
begin
  if ov ? col then return ov ->> col; end if;
  if col = 'organization_id' then return quote_literal(org) || '::uuid'; end if;
  if col in ('project_id','repository_id') then return quote_literal(proj) || '::uuid'; end if;
  if col in ('user_id','created_by','actor_id','requested_by','owner_id','approved_by','revoked_by') then return quote_literal(usr) || '::uuid'; end if;
  return case typ
    when 'uuid' then 'gen_random_uuid()'
    when 'text' then quote_literal('seed-' || gen_random_uuid()::text) when 'character varying' then quote_literal('seed-' || gen_random_uuid()::text) when 'character' then quote_literal('s')
    when 'USER-DEFINED' then coalesce((select quote_literal(e.enumlabel) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = udt order by e.enumsortorder limit 1), 'null')
    when 'integer' then '0' when 'bigint' then '0' when 'smallint' then '0' when 'numeric' then '0' when 'double precision' then '0' when 'real' then '0'
    when 'boolean' then 'false'
    when 'jsonb' then quote_literal('{}') || '::jsonb' when 'json' then quote_literal('{}') || '::json'
    when 'timestamp with time zone' then 'now()' when 'timestamp without time zone' then 'now()' when 'date' then 'current_date'
    when 'ARRAY' then quote_literal('{}')
    else 'null' end;
end $$;

create function iso.seed_sql(t text, org uuid, proj uuid, usr uuid, ov jsonb default '{}'::jsonb) returns text language plpgsql as $$
declare cols text; vals text;
begin
  select string_agg(quote_ident(column_name), ',' order by ordinal_position),
         string_agg(iso.lit(column_name, data_type, udt_name, org, proj, usr, ov), ',' order by ordinal_position)
    into cols, vals
  from information_schema.columns
  where table_schema = 'public' and table_name = t and is_generated = 'NEVER' and coalesce(is_identity,'NO') = 'NO'
    and ((is_nullable = 'NO' and column_default is null) or column_name in ('organization_id','project_id'));
  if cols is null then return format('insert into public.%I default values', t); end if;
  return format('insert into public.%I (%s) values (%s)', t, cols, vals);
end $$;
grant execute on all functions in schema iso to authenticated, anon;

-- Picks a value that satisfies a CHECK constraint that rejected the seed: the first literal of an IN / ANY(ARRAY[...]) list for text-like columns,
-- otherwise small numbers. Several attempts per table; whatever still fails is reported as NOT COVERED.
create function iso.fix_for_check(tbl text, def text, ov jsonb) returns jsonb language plpgsql as $fn$
declare c record; lit text; v text;
begin
  for c in select column_name, data_type from information_schema.columns where table_schema='public' and table_name = tbl order by ordinal_position loop
    if def ~ ('(^|[^a-z_])' || c.column_name || '([^a-z_]|$)') and not (ov ? c.column_name) then
      lit := (regexp_match(def, $re$'([^']+)'::$re$))[1];
      if c.data_type in ('text','character varying','USER-DEFINED') and lit is not null then
        return ov || jsonb_build_object(c.column_name, quote_literal(lit));
      elsif c.data_type in ('integer','bigint','smallint','numeric','double precision','real') then
        v := case when def ~ '(<=|<)\s*0([^0-9]|$)' then '0' else '1' end;
        return ov || jsonb_build_object(c.column_name, v);
      end if;
    end if;
  end loop;
  return ov;
end $fn$;

-- ---------- seed (as superuser; foreign keys and triggers off for the seeding only) ----------
set session_replication_role = replica;
do $$
declare r record; sa text; sb text; scope text; ok int := 0; total int := 0; ov jsonb; prev jsonb; attempt int; done boolean; last_err text; cname text; cdef text;
  oa uuid := '10000000-0000-4000-8000-0000000000a1'; ob uuid := '10000000-0000-4000-8000-0000000000b1';
  pa uuid := '20000000-0000-4000-8000-0000000000a1'; pb uuid := '20000000-0000-4000-8000-0000000000b1';
  ua uuid := '00000000-0000-4000-8000-0000000000a1'; ub uuid := '00000000-0000-4000-8000-0000000000b1';
begin
  for r in
    select c.relname as tbl, c.relrowsecurity as rls,
           case when exists (select 1 from information_schema.columns k where k.table_schema='public' and k.table_name=c.relname and k.column_name='organization_id') then 'organization_id'
                else 'project_id' end as scope_col
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from information_schema.columns k where k.table_schema='public' and k.table_name=c.relname and k.column_name in ('organization_id','project_id'))
    order by c.relname
  loop
    total := total + 1;
    scope := r.scope_col;
    ov := '{}'::jsonb; attempt := 0; done := false; last_err := null;
    while attempt < 8 and not done loop
      attempt := attempt + 1;
      sa := iso.seed_sql(r.tbl, oa, pa, ua, ov); sb := iso.seed_sql(r.tbl, ob, pb, ub, ov);
      begin
        if r.tbl not in ('organization_members','projects') then   -- those two were seeded explicitly above
          execute sa; execute sb;
        end if;
        insert into iso_cases values (r.tbl, scope, sa, true, null, r.rls);
        done := true; ok := ok + 1;
      exception
        when check_violation then
          get stacked diagnostics cname = constraint_name, last_err = message_text;
          select pg_get_constraintdef(oid) into cdef from pg_constraint where conname = cname and conrelid = ('public.' || quote_ident(r.tbl))::regclass limit 1;
          prev := ov; ov := iso.fix_for_check(r.tbl, coalesce(cdef, ''), ov);
          if ov = prev then exit; end if;
        when others then
          get stacked diagnostics last_err = message_text;
          exit;
      end;
    end loop;
    if not done then insert into iso_cases values (r.tbl, scope, sa, false, last_err, r.rls); end if;
  end loop;
  raise notice 'NOTE seeded % of % tables that carry organization_id/project_id', ok, total;
end $$;
reset session_replication_role;

-- non-vacuity: every seeded table really holds org A rows
do $$
declare r record; n bigint; empty int := 0;
begin
  for r in select * from iso_cases where seeded loop
    execute format('select count(*) from public.%I where %I = %L', r.tbl, r.scope_col, case when r.scope_col='organization_id' then '10000000-0000-4000-8000-0000000000a1' else '20000000-0000-4000-8000-0000000000a1' end) into n;
    if n = 0 then empty := empty + 1; raise notice 'FAIL seed: % has no organization A row (the test would be vacuous)', r.tbl; end if;
  end loop;
  if empty = 0 then raise notice 'PASS every seeded table holds organization A data (no vacuous checks)'; end if;
end $$;

-- tables that carry tenant data but have row level security switched off
do $$
declare r record;
begin
  for r in select * from iso_cases where not rls_on loop
    raise notice 'FAIL rls-off: public.% carries % and has ROW LEVEL SECURITY disabled', r.tbl, r.scope_col;
  end loop;
  if not exists (select 1 from iso_cases where not rls_on) then raise notice 'PASS every table that carries organization_id/project_id has row level security enabled'; end if;
end $$;

-- ---------- act as outsiders ----------
create function iso.probe(actor text) returns void language plpgsql as $$
declare r record; n bigint; v text; denied int := 0; sees int := 0; wrote int := 0; leaked int := 0; inserts_refused int := 0; inserts_inconclusive int := 0;
  a text; code text;
begin
  for r in select * from iso_cases where seeded order by tbl loop
    a := case when r.scope_col = 'organization_id' then '10000000-0000-4000-8000-0000000000a1' else '20000000-0000-4000-8000-0000000000a1' end;
    -- read
    begin
      execute format('select count(*) from public.%I where %I = %L', r.tbl, r.scope_col, a) into n;
      if n > 0 then leaked := leaked + 1; raise notice 'FAIL %: % can READ % row(s) of organization A in public.%', actor, actor, n, r.tbl; end if;
    exception when insufficient_privilege then denied := denied + 1; end;
    -- update
    begin
      execute format('update public.%I set %I = %I where %I = %L', r.tbl, r.scope_col, r.scope_col, r.scope_col, a);
      get diagnostics n = row_count;
      if n > 0 then wrote := wrote + 1; raise notice 'FAIL %: % UPDATED % row(s) of organization A in public.%', actor, actor, n, r.tbl; end if;
    exception when insufficient_privilege then denied := denied + 1; when others then null; end;
    -- delete
    begin
      execute format('delete from public.%I where %I = %L', r.tbl, r.scope_col, a);
      get diagnostics n = row_count;
      if n > 0 then wrote := wrote + 1; raise notice 'FAIL %: % DELETED % row(s) of organization A in public.%', actor, actor, n, r.tbl; end if;
    exception when insufficient_privilege then denied := denied + 1; when others then null; end;
    -- insert into A
    begin
      execute r.seed_a;
      wrote := wrote + 1; raise notice 'FAIL %: % INSERTED a row into organization A in public.%', actor, actor, r.tbl;
    exception when insufficient_privilege then inserts_refused := inserts_refused + 1;
              when others then inserts_inconclusive := inserts_inconclusive + 1; get stacked diagnostics code = returned_sqlstate;
                                raise notice 'NOTE insert into public.% by % refused with SQLSTATE % (not an RLS error; counted as inconclusive)', r.tbl, actor, code;
    end;
  end loop;
  raise notice 'SUMMARY %: tables probed=%; reads leaked=%; writes that changed organization A=%; inserts refused by RLS/privileges=%; inserts inconclusive=%; statements denied outright=%',
    actor, (select count(*) from iso_cases where seeded), leaked, wrote, inserts_refused, inserts_inconclusive, denied;
  if leaked = 0 and wrote = 0 then raise notice 'PASS % cannot read or change any organization A data in the % tables probed', actor, (select count(*) from iso_cases where seeded); end if;
end $$;
grant execute on all functions in schema iso to authenticated, anon;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000b1', true);
select iso.probe('member of organization B');
rollback;

begin;
set local role anon;
select iso.probe('anonymous visitor');
rollback;

-- positive control: a member DOES see their own organization (the policies are not simply denying everything)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare mine bigint; tables_visible int := 0; r record; n bigint;
begin
  for r in select * from iso_cases where seeded loop
    begin
      execute format('select count(*) from public.%I where %I = %L', r.tbl, r.scope_col, case when r.scope_col='organization_id' then '10000000-0000-4000-8000-0000000000a1' else '20000000-0000-4000-8000-0000000000a1' end) into n;
      if n > 0 then tables_visible := tables_visible + 1;
      else
        raise notice 'NOTE positive control: member of A sees none of the A rows in public.% -- policies: %', r.tbl,
          coalesce((select string_agg(cmd || ' to ' || array_to_string(roles, ',') || ' using(' || coalesce(left(qual, 70), '-') || ')', '; ') from pg_policies where schemaname='public' and tablename=r.tbl), 'none (access only through service_role/SECURITY DEFINER)');
      end if;
    exception when others then raise notice 'NOTE positive control: select on public.% errored (%): privileges revoked from authenticated', r.tbl, sqlerrm; end;
  end loop;
  if tables_visible > 0 then raise notice 'PASS positive control: a member of organization A sees their own data in % tables (the policies are not just denying everything)', tables_visible;
  else raise notice 'FAIL positive control: a member of organization A sees nothing of their own'; end if;
end $$;
rollback;

-- coverage honesty
do $$
declare r record;
begin
  for r in select * from iso_cases where not seeded order by tbl loop
    raise notice 'NOTE NOT COVERED: public.% (could not be seeded generically: %)', r.tbl, left(r.skip_reason, 90);
  end loop;
end $$;
drop schema iso cascade;

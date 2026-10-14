#!/usr/bin/env bash
# Cross-organization isolation on a THROWAWAY PostgreSQL cluster (needs PostgreSQL >= 14 binaries on PATH): builds the database from ALL
# database/migrations with minimal Supabase stand-ins, then runs database/tests/cross_org_isolation.sql. Touches nothing but its own temp cluster:
# no network, no credentials, no production data. Exit code 1 when any line says FAIL.
set -euo pipefail
cd "$(dirname "$0")/.."
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
PORT="${PGTEST_PORT:-54331}"; DIR="$(mktemp -d /tmp/sequrai-pg-isolation.XXXXXX)"
trap 'pg_ctl -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
initdb -D "$DIR" -U postgres --auth=trust -E UTF8 >/dev/null
pg_ctl -D "$DIR" -o "-p $PORT -k $DIR" -l "$DIR/log" -w start >/dev/null
P=(psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${P[@]}" -c "create database sequrai_test"
P+=(-d sequrai_test)
"${P[@]}" <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'authenticated') $$;
create extension if not exists pgcrypto; create extension if not exists pg_trgm;
create publication supabase_realtime;
SQL
n=0
for f in $(ls database/migrations/*.sql | sort); do
  "${P[@]}" -f "$f" >/dev/null 2>"$DIR/err.txt" || { echo "migration failed: $f"; head -5 "$DIR/err.txt"; exit 1; }
  n=$((n+1))
done
echo "migrations applied: $n"
OUT="$("${P[@]}" -f database/tests/cross_org_isolation.sql 2>&1 | sed -e 's/^psql:[^ ]* //' -e 's/^NOTICE:  //' -e 's/^WARNING:  //' | grep -E "PASS|FAIL|NOTE|SUMMARY|ERROR" || true)"
echo "$OUT"
if echo "$OUT" | grep -qE "^(FAIL|ERROR)|ERROR:"; then echo "ISOLATION CHECK FAILED"; exit 1; fi
echo "ISOLATION CHECK PASSED"

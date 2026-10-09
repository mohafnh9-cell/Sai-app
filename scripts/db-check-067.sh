#!/usr/bin/env bash
# Throwaway-cluster check of migration 067 on a REAL PostgreSQL (needs PostgreSQL >= 14 binaries on PATH).
# Builds the database from database/migrations/001-066 with minimal Supabase stand-ins (roles, auth schema,
# realtime publication), then runs database/tests/067_safe_fix_proposal_commit_check.sql in the order
# "before 067 -> apply 067 -> after 067 -> RLS -> rollback rehearsal". Touches nothing but its own temp cluster.
set -euo pipefail
cd "$(dirname "$0")/.."
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
PORT="${PGTEST_PORT:-54329}"; DIR="$(mktemp -d /tmp/sequrai-pg-check.XXXXXX)"
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
create function auth.role() returns text language sql stable as $$ select 'service_role' $$;
create extension if not exists pgcrypto; create extension if not exists pg_trgm;
create publication supabase_realtime;
SQL
for f in $(ls database/migrations/*.sql | sort); do
  case "$f" in *067_*) continue;; esac           # 067 is applied BY the check, in the middle of it
  "${P[@]}" -f "$f" >/dev/null 2>&1 || { echo "migration failed: $f"; exit 1; }
done
echo "migrations 001-066 applied"
"${P[@]}" -f database/tests/067_safe_fix_proposal_commit_check.sql 2>&1 | sed -e 's/^psql:[^ ]* //' -e 's/^NOTICE:  //' | grep -E "PASS|FAIL|ERROR" 

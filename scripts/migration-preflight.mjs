#!/usr/bin/env node
/**
 * Phase 1.6 migration preflight — validates scan_jobs schema after 020/021.
 *
 * Usage:
 *   node scripts/migration-preflight.mjs
 *   node scripts/migration-preflight.mjs --sql-only
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local"), override: true });
config({ path: resolve(process.cwd(), ".env"), override: true });

const sqlOnly = process.argv.includes("--sql-only");

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const checks = [
  {
    name: "scan_jobs table exists",
    sql: `select to_regclass('public.scan_jobs') is not null as ok`,
  },
  {
    name: "scan_job_events table exists",
    sql: `select to_regclass('public.scan_job_events') is not null as ok`,
  },
  {
    name: "operation_idempotency table exists",
    sql: `select to_regclass('public.operation_idempotency') is not null as ok`,
  },
  {
    name: "scan_jobs recovery columns",
    sql: `
      select count(*) = 9 as ok
      from information_schema.columns
      where table_schema = 'public' and table_name = 'scan_jobs'
        and column_name in (
          'heartbeat_at','execution_deadline_at','last_recovery_at',
          'recovery_attempts','max_recovery_attempts','locked_at','locked_by',
          'queue_wait_ms','duration_ms'
        )`,
  },
  {
    name: "scan_jobs partial unique indexes",
    sql: `
      select count(*) >= 2 as ok
      from pg_indexes
      where schemaname = 'public' and tablename = 'scan_jobs'
        and indexname in ('idx_scan_jobs_webhook_delivery','idx_scan_jobs_active_scan')`,
  },
  {
    name: "scan_jobs stuck recovery index",
    sql: `
      select exists (
        select 1 from pg_indexes
        where schemaname = 'public' and tablename = 'scan_jobs'
          and indexname = 'idx_scan_jobs_stuck_recovery'
      ) as ok`,
  },
  {
    name: "scan_job_events indexes",
    sql: `
      select count(*) >= 3 as ok
      from pg_indexes
      where schemaname = 'public' and tablename = 'scan_job_events'
        and indexname in (
          'idx_scan_job_events_type_created',
          'idx_scan_job_events_org_created',
          'idx_scan_job_events_job_created'
        )`,
  },
  {
    name: "operation_idempotency primary key",
    sql: `
      select exists (
        select 1 from information_schema.table_constraints
        where table_schema = 'public' and table_name = 'operation_idempotency'
          and constraint_type = 'PRIMARY KEY'
      ) as ok`,
  },
  {
    name: "scan_jobs RLS enabled",
    sql: `
      select relrowsecurity as ok
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'scan_jobs'`,
  },
  {
    name: "scan_job_events RLS enabled",
    sql: `
      select relrowsecurity as ok
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'scan_job_events'`,
  },
  {
    name: "operation_idempotency RLS enabled",
    sql: `
      select relrowsecurity as ok
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'operation_idempotency'`,
  },
  {
    name: "scan_jobs member read policy",
    sql: `
      select exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'scan_jobs'
          and policyname = 'Members read scan jobs'
      ) as ok`,
  },
  {
    name: "recovery defaults",
    sql: `
      select
        (select column_default from information_schema.columns
         where table_schema='public' and table_name='scan_jobs' and column_name='recovery_attempts') is not null
        and
        (select column_default from information_schema.columns
         where table_schema='public' and table_name='scan_jobs' and column_name='max_recovery_attempts') is not null
      as ok`,
  },
];

async function runChecks() {
  const admin = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results = [];
  for (const check of checks) {
    const { data, error } = await admin.rpc("exec_sql_check", { query: check.sql }).catch(() => ({
      data: null,
      error: { message: "rpc_unavailable" },
    }));

    if (error?.message === "rpc_unavailable") {
      results.push({ name: check.name, status: "skipped", detail: "Use SQL file against Supabase SQL editor" });
      continue;
    }

    if (error) {
      results.push({ name: check.name, status: "error", detail: error.message });
      continue;
    }

    const ok = Array.isArray(data) ? data[0]?.ok : data?.ok;
    results.push({ name: check.name, status: ok ? "pass" : "fail", detail: ok ? "ok" : "check returned false" });
  }

  return results;
}

async function main() {
  const sqlPath = resolve(dirname(fileURLToPath(import.meta.url)), "migration-preflight.sql");
  const sql = readFileSync(sqlPath, "utf8");

  if (sqlOnly) {
    console.log(sql);
    return;
  }

  console.log("=== Migration preflight (020 + 021) ===\n");
  console.log("Staging apply commands:");
  console.log("  npm run db:apply-migrations");
  console.log("  # or manually in Supabase SQL editor:");
  console.log("  #   database/migrations/020_scan_jobs.sql");
  console.log("  #   database/migrations/021_scan_job_observability.sql");
  console.log("\nSQL validation file: scripts/migration-preflight.sql\n");

  try {
    const results = await runChecks();
    for (const result of results) {
      console.log(`[${result.status.toUpperCase()}] ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
    }
    const failed = results.filter((r) => r.status === "fail" || r.status === "error");
    if (failed.length > 0) process.exit(1);
    if (results.every((r) => r.status === "skipped")) {
      console.log("\nRun scripts/migration-preflight.sql in Supabase SQL editor for full validation.");
    } else {
      console.log("\nPreflight passed.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.log("\nFallback: run scripts/migration-preflight.sql in Supabase SQL editor.");
    process.exit(1);
  }
}

main();

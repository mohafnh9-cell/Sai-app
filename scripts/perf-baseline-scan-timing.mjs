#!/usr/bin/env node
// Read-only: pulls real historical scan timing from scan_jobs.metadata.executionTrace
// for Phase 8's performance baseline. No writes, no scan triggered.
import { createAdminScriptClient } from "./lib/supabase-admin.mjs";

const admin = createAdminScriptClient();

async function main() {
  const { data: jobs, error } = await admin
    .from("scan_jobs")
    .select("id, scan_id, project_id, organization_id, status, created_at, updated_at, metadata")
    .eq("status", "completed")
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("query_failed", error.message);
    return;
  }
  if (!jobs || jobs.length === 0) {
    console.log("no completed scan_jobs found");
    return;
  }

  const projectIds = [...new Set(jobs.map((j) => j.project_id))];
  const { data: projects } = await admin
    .from("projects")
    .select("id, name, github_repo")
    .in("id", projectIds);
  const projectById = new Map((projects ?? []).map((p) => [p.id, p]));

  const rows = [];
  for (const job of jobs) {
    const trace = job.metadata?.executionTrace?.stages ?? [];
    const byStage = Object.fromEntries(trace.map((s) => [s.stage, s.at]));
    const started = byStage.scan_started ? new Date(byStage.scan_started).getTime() : null;
    const verdictPersisted = byStage.verdict_persisted
      ? new Date(byStage.verdict_persisted).getTime()
      : null;
    const createdAt = new Date(job.created_at).getTime();
    const updatedAt = new Date(job.updated_at).getTime();

    rows.push({
      project: projectById.get(job.project_id)?.name ?? job.project_id,
      scanJobId: job.id,
      queuedToStarted:
        started != null ? ((started - createdAt) / 1000).toFixed(1) + "s" : "n/a",
      scanExecution:
        started != null && verdictPersisted != null
          ? ((verdictPersisted - started) / 1000).toFixed(1) + "s"
          : "n/a",
      totalJobDuration: ((updatedAt - createdAt) / 1000).toFixed(1) + "s",
      hasTrace: trace.length > 0,
    });
  }

  console.table(rows);
}

main();

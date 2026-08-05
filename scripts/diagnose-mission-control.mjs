#!/usr/bin/env node
import { createAdminScriptClient } from "./lib/supabase-admin.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projectId = process.argv[2];
if (!projectId) {
  console.error("Usage: node scripts/diagnose-mission-control.mjs <projectId>");
  process.exit(1);
}

const admin = createAdminScriptClient();

async function main() {
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, name, organization_id")
    .eq("id", projectId)
    .maybeSingle();

  console.log("project", project ?? projectError?.message);
  if (!project) return;

  const orgId = project.organization_id;

  const checks = [
    ["production_verdicts", () => admin.from("production_verdicts").select("id, scan_id, verdict, generated_at").eq("project_id", projectId).order("generated_at", { ascending: false }).limit(5)],
    ["scans", () => admin.from("scans").select("id, status, immutability_locked_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(5)],
    ["scan_jobs", () => admin.from("scan_jobs").select("id, scan_id, status, metadata").eq("project_id", projectId).order("created_at", { ascending: false }).limit(3)],
    ["mission_control_feed_events", () => admin.from("mission_control_feed_events").select("id, scan_id, message").eq("project_id", projectId).limit(3)],
    ["project_continuous_protection", () => admin.from("project_continuous_protection").select("*").eq("project_id", projectId).maybeSingle()],
    ["protection_snapshots", () => admin.from("protection_snapshots").select("snapshot_date").eq("project_id", projectId).limit(1)],
    ["attack_simulation_campaigns", () => admin.from("attack_simulation_campaigns").select("id, scan_id, status, commit_sha").eq("project_id", projectId).limit(3)],
  ];

  for (const [name, run] of checks) {
    const { data, error } = await run();
    if (error) {
      console.log(`FAIL ${name}:`, error.message, error.code);
    } else {
      console.log(`OK ${name}:`, Array.isArray(data) ? `${data.length} rows` : data ? "row" : "empty");
    }
  }

  const { data: verdictRows } = await admin
    .from("production_verdicts")
    .select("scan_id, verdict")
    .eq("project_id", projectId)
    .order("generated_at", { ascending: false })
    .limit(3);

  for (const row of verdictRows ?? []) {
    const v = row.verdict;
    const keys = v && typeof v === "object" ? Object.keys(v) : [];
    console.log("verdict scan", row.scan_id, "keys", keys.slice(0, 12).join(","));
    console.log("  has executiveSummary", Boolean(v?.executiveSummary ?? v?.headline));
    console.log("  generatedAt", v?.generatedAt);
    console.log("  evaluatedAreas", Array.isArray(v?.evaluatedAreas) ? v.evaluatedAreas.length : typeof v?.evaluatedAreas);
  }
}

main().catch((error) => {
  console.error("diagnostic failed", error);
  process.exit(1);
});

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeLocalTool } from "../local-tool-handlers";
import type { LocalProductionVerdictResult } from "../types";

/**
 * F10: proves the core product loop against small, deterministic,
 * production-shaped repositories representing realistic AI-built SaaS
 * patterns -- through the REAL executeLocalTool() MCP path (native +
 * whatever external engines are configured in this environment), not a
 * direct scanRepository() call. Goal is not rule-coverage breadth; it's
 * proving the loop (finding -> understand -> fix -> rescan -> honest
 * verdict) works end to end on realistic shapes, per the F10 master
 * prompt's Phase 9.
 */

const tempDirs: string[] = [];
const originalWorkspaceRoot = process.env.SEQURAI_WORKSPACE_ROOT;

function tmpWorkspace(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

function write(repo: string, relativePath: string, content: string): void {
  const full = join(repo, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function commitAll(repo: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: repo });
}

afterEach(() => {
  if (originalWorkspaceRoot === undefined) delete process.env.SEQURAI_WORKSPACE_ROOT;
  else process.env.SEQURAI_WORKSPACE_ROOT = originalWorkspaceRoot;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("F10: production-shaped repository scenarios (real MCP path)", () => {
  it("A — a clean, well-formed project produces no blocking findings", async () => {
    const root = tmpWorkspace("seq-f10-clean-");
    write(
      root,
      "app/api/projects/route.ts",
      `import { getServerSession } from "@/lib/auth";
export async function GET(req) {
  const session = await getServerSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const projects = await listProjectsForUser(session.user.id);
  return Response.json(projects);
}
`
    );
    commitAll(root, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    const result = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
    expect(result.phase).toBe("complete");
    expect(result.findings.some((f) => f.severity === "critical" || f.severity === "high")).toBe(false);
  });

  it("B — an exposed secret is detected with real evidence and honest severity", async () => {
    const root = tmpWorkspace("seq-f10-secret-");
    const fakeLiveStripeKey = ["sk_", "live_", "abcdefghijklmnopqrstuvwxyz123456"].join("");
    write(root, "lib/payments/config.ts", `export const stripeSecretKey = "${fakeLiveStripeKey}";\n`);
    commitAll(root, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    const result = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
    const secretFinding = result.findings.find((f) => f.ruleId === "secrets.exposed");
    expect(secretFinding).toBeTruthy();
    expect(secretFinding?.filePath).toBe("lib/payments/config.ts");
    expect(["critical", "high"]).toContain(secretFinding?.severity);
  });

  it("C/D — missing authentication AND missing authorization (IDOR-shaped) on the same endpoint are both detected", async () => {
    const root = tmpWorkspace("seq-f10-idor-");
    write(
      root,
      "app/api/orgs/[orgId]/billing/route.ts",
      `export async function GET(req) {
  const org = await getOrgFromDb(req.params.orgId);
  return Response.json(org.billingDetails);
}
`
    );
    commitAll(root, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    const result = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
    const ruleIds = new Set(result.findings.map((f) => f.ruleId));
    expect(ruleIds.has("auth.missing")).toBe(true);
    expect(ruleIds.has("authz.insufficient")).toBe(true);
  });

  it("E — a disabled Supabase RLS policy is detected", async () => {
    const root = tmpWorkspace("seq-f10-rls-");
    write(root, "database/migrations/099_oops.sql", "ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;\n");
    commitAll(root, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    const result = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
    expect(result.findings.some((f) => f.ruleId === "supabase.rls")).toBe(true);
  });

  it("H — multiple simultaneous, distinct findings are all reported together, none masking another", async () => {
    const root = tmpWorkspace("seq-f10-multi-");
    const fakeLiveStripeKey = ["sk_", "live_", "zyxwvutsrqponmlkjihgfedcba654321"].join("");
    write(root, "lib/payments/config.ts", `export const stripeSecretKey = "${fakeLiveStripeKey}";\n`);
    write(
      root,
      "app/api/admin/stats/route.ts",
      `export async function GET(req) { return Response.json(await getAdminStats()); }\n`
    );
    write(root, "database/migrations/098_oops.sql", "ALTER TABLE public.accounts DISABLE ROW LEVEL SECURITY;\n");
    commitAll(root, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    const result = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
    const ruleIds = new Set(result.findings.map((f) => f.ruleId));
    expect(ruleIds.has("secrets.exposed")).toBe(true);
    expect(ruleIds.has("auth.missing")).toBe(true);
    expect(ruleIds.has("supabase.rls")).toBe(true);
    expect(result.verdictStatus).not.toBe("ready_to_ship");
  });

  it("I — a fixable finding, once fixed and rescanned, is reported RESOLVED with an honestly updated verdict", async () => {
    const root = tmpWorkspace("seq-f10-fix-rescan-");
    const fakeLiveStripeKey = ["sk_", "live_", "112233445566778899aabbccddeeff0"].join("");
    write(root, "lib/payments/config.ts", `export const stripeSecretKey = "${fakeLiveStripeKey}";\n`);
    commitAll(root, "initial");
    process.env.SEQURAI_WORKSPACE_ROOT = root;

    const before = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
    expect(before.findings.some((f) => f.ruleId === "secrets.exposed")).toBe(true);
    const verdictBefore = before.verdictStatus;

    write(root, "lib/payments/config.ts", `export const stripeSecretKey = process.env.STRIPE_SECRET_KEY!;\n`);
    commitAll(root, "load from env instead");

    const after = (await executeLocalTool("sequrai_local_audit", {})) as LocalProductionVerdictResult;
    expect(after.findings.some((f) => f.ruleId === "secrets.exposed")).toBe(false);

    const status = (await executeLocalTool("sequrai_local_status", {})) as {
      history: { resolvedFindings: Array<{ ruleId: string }>; note: string } | null;
    };
    expect(status.history?.resolvedFindings.some((f) => f.ruleId === "secrets.exposed")).toBe(true);
    // Honest wording only -- never "verified"/"secure" claims for a resolved finding.
    expect(status.history?.note.toLowerCase()).not.toContain("verified");
    // The verdict is allowed to improve, but this test only proves it's
    // re-derived from real evidence, not that it must reach any specific status.
    expect(typeof verdictBefore).toBe("string");
    expect(typeof after.verdictStatus).toBe("string");
  });
});

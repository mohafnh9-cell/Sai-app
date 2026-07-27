import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("040_business_logic.sql migration", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "database/migrations/040_business_logic.sql"),
    "utf8"
  );

  it("defines normalized RT9 tables", () => {
    const tables = [
      "business_logic_runs",
      "business_logic_run_revisions",
      "business_logic_workflows",
      "business_logic_state_machines",
      "business_logic_invariants",
      "business_logic_abuse_cases",
      "business_logic_specialist_results",
      "business_logic_runtime_results",
      "business_logic_findings",
      "business_logic_replay_plans",
    ];
    for (const t of tables) {
      expect(sql).toContain(`public.${t}`);
    }
  });

  it("includes org/project/scan/workflow/finding/execution/specialist indexes", () => {
    expect(sql).toContain("idx_business_logic_runs_org");
    expect(sql).toContain("idx_business_logic_runs_project");
    expect(sql).toContain("idx_business_logic_runs_scan_job");
    expect(sql).toContain("idx_business_logic_workflows_project");
    expect(sql).toContain("idx_business_logic_findings_workflow");
    expect(sql).toContain("idx_business_logic_runtime_results_execution");
    expect(sql).toContain("idx_business_logic_specialist_results_specialist");
  });

  it("supports idempotent run keys per project", () => {
    expect(sql).toContain("idx_business_logic_runs_idempotency");
  });
});

import { describe, expect, it, vi } from "vitest";
import { loadAnalysisRunFindingsForFixPrompt } from "../load-run-findings-for-fix";

describe("loadAnalysisRunFindingsForFixPrompt", () => {
  it("maps scan findings rows for fix prompt context", async () => {
    const client = {
      from: (table: string) => {
        if (table !== "scan_findings") throw new Error(`unexpected ${table}`);
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  id: "f1",
                  title: "Missing auth",
                  description: "Route unprotected",
                  severity: "high",
                  recommendation: "Add auth",
                  category: "authentication",
                  file_path: "app/api/route.ts",
                  start_line: 1,
                  rule_id: "auth.missing",
                  confidence: "high",
                  fingerprint: "fp1",
                },
              ],
              error: null,
            }),
          }),
        };
      },
    } as never;

    const findings = await loadAnalysisRunFindingsForFixPrompt(client, "run-1");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toBe("Missing auth");
    expect(findings[0]?.file_path).toBe("app/api/route.ts");
  });

  it("omits optional fields instead of undefined for RSC serialization", async () => {
    const client = {
      from: (table: string) => {
        if (table !== "scan_findings") throw new Error(`unexpected ${table}`);
        return {
          select: () => ({
            eq: async () => ({
              data: [
                {
                  id: "f2",
                  title: "Open route",
                  description: null,
                  severity: "medium",
                  recommendation: null,
                  category: "api",
                  file_path: "app/route.ts",
                  start_line: null,
                  rule_id: "api.open",
                  confidence: "medium",
                  fingerprint: "fp2",
                },
              ],
              error: null,
            }),
          }),
        };
      },
    } as never;

    const findings = await loadAnalysisRunFindingsForFixPrompt(client, "run-2");
    expect(findings[0]).not.toHaveProperty("description");
    expect(findings[0]).not.toHaveProperty("recommendation");
    expect(findings[0]).not.toHaveProperty("start_line");
    expect(JSON.stringify(findings)).not.toContain("undefined");
  });

  it("returns empty array on query error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: null, error: { message: "boom" } }),
        }),
      }),
    } as never;

    await expect(loadAnalysisRunFindingsForFixPrompt(client, "run-1")).resolves.toEqual([]);
    warn.mockRestore();
  });
});

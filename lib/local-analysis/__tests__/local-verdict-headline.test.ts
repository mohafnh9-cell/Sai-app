import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { localVerdictHeadline, runLocalProductionVerdict } from "../run-local-verdict";
import { containsApprovalLanguage } from "@/brain/production-verdict/narrative-guard";

const area = (key: string) => ({ key, label: key, score: null, status: "not_evaluated", confidence: "low", limitations: "", methodology: "", evidenceCount: 0 });
const v = (over: Record<string, unknown>) => ({ status: "ready_to_ship", confidence: "high", unevaluatedAreas: [], partiallyEvaluatedAreas: [], ...over }) as never;

describe("localVerdictHeadline: status alone can never authorize deployment language", () => {
  it("READY + high confidence + complete coverage: READY TO SHIP is permitted", () => {
    expect(localVerdictHeadline(v({}))).toBe("READY TO SHIP");
  });

  it("READY + evidence limited (low or medium confidence, unevaluated or partial areas): never READY TO SHIP", () => {
    for (const over of [
      { confidence: "low" },
      { confidence: "medium" },
      { unevaluatedAreas: [area("testing")] },
      { partiallyEvaluatedAreas: [area("performance")] },
    ]) {
      expect(localVerdictHeadline(v(over))).toBe("NO BLOCKERS FOUND — EVIDENCE LIMITED");
    }
  });

  it("missing or unreadable confidence/coverage is conservative", () => {
    for (const over of [{ confidence: undefined }, { confidence: "bogus" }, { unevaluatedAreas: undefined }, { partiallyEvaluatedAreas: undefined }, { unevaluatedAreas: null }]) {
      expect(localVerdictHeadline(v(over))).toBe("NO BLOCKERS FOUND — EVIDENCE LIMITED");
    }
  });

  it("NOT_READY / INSUFFICIENT_DATA / FAILED keep their own non-approval headlines", () => {
    expect(localVerdictHeadline(v({ status: "not_ready", confidence: "low" }))).toBe("NOT READY TO SHIP");
    expect(localVerdictHeadline(v({ status: "insufficient_data", confidence: "low" }))).toBe("MORE ANALYSIS REQUIRED");
    expect(localVerdictHeadline(v({ status: "analysis_failed", confidence: "low" }))).toBe("ANALYSIS FAILED");
  });

  it("no non-READY input can ever produce READY TO SHIP, whatever the confidence/coverage", () => {
    for (const status of ["almost_ready", "needs_improvement", "not_ready", "insufficient_data", "analysis_failed"]) {
      expect(localVerdictHeadline(v({ status }))).not.toBe("READY TO SHIP");
    }
  });
});

describe("the real local-audit result an agent receives (narrative STATUS line)", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  function workspace(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "sequrai-local-headline-"));
    dirs.push(dir);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return dir;
  }
  const tiny = (n: number) =>
    Object.fromEntries([
      ["package.json", '{ "name": "ws-fixture", "version": "0.0.0", "private": true }\n'],
      ...Array.from({ length: n }, (_, i) => [`src/math${i}.ts`, `export function add${i}(a: number, b: number): number {\n  return a + b + ${i};\n}\n`]),
    ]);
  const statusLine = (narrative: string) => narrative.split("\nSTATUS\n")[1]?.split("\n")[0];

  it("evidence-limited workspace (9 files, medium confidence, 4 areas unevaluated): the STATUS line is not READY TO SHIP", async () => {
    const r = await runLocalProductionVerdict({ workspacePath: workspace(tiny(8)), scope: "workspace", persist: false });
    expect(r.verdictStatus).toBe("ready_to_ship"); // raw status stays raw metadata
    expect((r.productionVerdict as { confidence: string }).confidence).not.toBe("high");
    expect(statusLine(r.narrative)).toBe("NO BLOCKERS FOUND — EVIDENCE LIMITED");
    expect(r.narrative).not.toContain("READY TO SHIP");
    expect(containsApprovalLanguage(r.narrative), r.narrative).toBe(false);
  }, 120_000);

  it("NOT_READY workspace: the STATUS line says NOT READY TO SHIP", async () => {
    const files = { ...tiny(4), "src/session-token.ts": 'import jwt from "jsonwebtoken";\nexport function verify(t: string, k: string) {\n  return jwt.verify(t, k, { algorithms: ["none"] });\n}\n' };
    const r = await runLocalProductionVerdict({ workspacePath: workspace(files), scope: "workspace", persist: false });
    expect(r.verdictStatus).toBe("not_ready");
    expect(statusLine(r.narrative)).toBe("NOT READY TO SHIP");
  }, 120_000);

  it("genuinely READY workspace (60 files: high confidence, every area evaluated): READY TO SHIP is permitted", async () => {
    const r = await runLocalProductionVerdict({ workspacePath: workspace(tiny(59)), scope: "workspace", persist: false });
    const verdict = r.productionVerdict as { confidence: string; unevaluatedAreas: unknown[]; partiallyEvaluatedAreas: unknown[] };
    expect(verdict.confidence).toBe("high");
    expect(verdict.unevaluatedAreas).toHaveLength(0);
    expect(verdict.partiallyEvaluatedAreas).toHaveLength(0);
    expect(statusLine(r.narrative)).toBe("READY TO SHIP");
  }, 120_000);
});

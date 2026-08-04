import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * ADR-001 enforcement.
 *
 * These tests fail loudly if a future change reintroduces a parallel,
 * independently-calculated product-truth source outside the Production
 * Verdict Engine. They are deliberately simple source scans, not a custom
 * lint framework — see docs/ADR_001_ARCHITECTURE_CLEANUP_REPORT.md.
 */

const ROOT = path.resolve(__dirname, "../..");

const SCAN_DIRS = ["app", "brain", "server", "features"];
const SKIP_SEGMENTS = ["node_modules", ".next", ".git", "__tests__", "test"];

function walk(dir: string, files: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_SEGMENTS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function allSourceFiles(): string[] {
  return SCAN_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
}

describe("ADR-001: single source of truth enforcement", () => {
  it("never reintroduces calculateProductionReadiness (legacy readiness engine, removed)", () => {
    const offenders: string[] = [];
    for (const file of allSourceFiles()) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("calculateProductionReadiness")) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never reintroduces estimateRiskFromScan (deleted parallel risk score)", () => {
    const offenders: string[] = [];
    for (const file of allSourceFiles()) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("estimateRiskFromScan")) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not let MCP or project-brain adapters define their own severity penalty tables", () => {
    // Only brain/production-verdict/* may define SEVERITY_PENALTY. Everything
    // else must consume the Verdict Engine's output, not invent its own
    // weighting table.
    const offenders: string[] = [];
    for (const file of allSourceFiles()) {
      const relative = path.relative(ROOT, file);
      if (relative.startsWith(path.join("brain", "production-verdict"))) continue;
      const content = fs.readFileSync(file, "utf8");
      if (/\bSEVERITY_PENALTY\b/.test(content)) {
        offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the legacy production-readiness module deleted", () => {
    expect(fs.existsSync(path.join(ROOT, "brain", "production-readiness"))).toBe(false);
  });

  it("does not mutate Production Verdict status outside brain/production-verdict", () => {
    const offenders: string[] = [];
    const allowedAssignPatterns = [/brain\/production-verdict\//];

    for (const file of allSourceFiles()) {
      const relative = path.relative(ROOT, file);
      if (allowedAssignPatterns.some((pattern) => pattern.test(relative))) continue;
      const content = fs.readFileSync(file, "utf8");
      if (/\.status\s*=\s*mapDeploymentVerdictToScanStatus/.test(content)) {
        offenders.push(relative);
      }
      if (/applySecurityDecisionToProductionVerdict\([\s\S]*?\)\s*;/.test(content)) {
        if (!relative.includes("production-verdict-bridge.ts")) {
          offenders.push(relative);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

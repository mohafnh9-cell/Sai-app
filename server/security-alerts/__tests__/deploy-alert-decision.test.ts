import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import {
  buildDeployAlertDedupeKey,
  decisionScanIdFromDedupeKey,
  deriveDeployAlertDecision,
  isHistoricalAlert,
  type DeployAlertDecisionInput,
} from "../deploy-alert-decision";
import { evaluateDeployCheckAlert } from "../evaluate-project";
import { enrichMcpToolResultWithAlerts, loadMcpAlertSurface } from "../mcp-enrichment";

// Pass 4 HIGH-004: alerts answer from the canonical decision. They must not
// recommend Safe Fix where safe_fix reports no actionable finding, and a
// superseded decision's alert must be explicitly historical.

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const SCAN = "33333333-3333-4333-8333-333333333333";
const OLD_SCAN = "44444444-4444-4444-8444-444444444444";

function decision(overrides: Partial<DeployAlertDecisionInput> = {}): DeployAlertDecisionInput {
  return {
    deploymentRecommendation: "MORE_ANALYSIS_REQUIRED",
    verdictStatus: "insufficient_data",
    reviewInProgress: false,
    reviewFailed: false,
    freshnessStatus: "current",
    hasActionableFinding: false,
    verdictScanId: SCAN,
    primaryWorry: null,
    ...overrides,
  };
}

const derive = (o: Partial<DeployAlertDecisionInput> = {}) => deriveDeployAlertDecision(PROJECT, decision(o));

describe("deploy alert action follows the canonical decision", () => {
  it("insufficient_data + no actionable finding -> review/analyze, NOT Safe Fix", () => {
    const d = derive();
    expect(d?.action).toBe("analyze");
    expect(d?.ctaType).toBe("review_again");
    expect(d?.nextAction).not.toMatch(/safe fix/i);
    expect(d?.nextAction).toMatch(/review/i);
  });

  it("insufficient_data + a concrete actionable finding -> Safe Fix is allowed", () => {
    const d = derive({ hasActionableFinding: true, primaryWorry: "Missing auth on /admin" });
    expect(d?.action).toBe("safe_fix");
    expect(d?.ctaType).toBe("safe_fix");
    expect(d?.changedBullets).toEqual(["Missing auth on /admin"]);
  });

  it("not_ready + a blocker -> Safe Fix", () => {
    const d = derive({
      deploymentRecommendation: "DO_NOT_DEPLOY",
      verdictStatus: "not_ready",
      hasActionableFinding: true,
      primaryWorry: "Exposed secret",
    });
    expect(d?.action).toBe("safe_fix");
    expect(d?.nextAction).toMatch(/safe fix/i);
  });

  it("not_ready with no actionable finding -> review, NOT Safe Fix", () => {
    const d = derive({ deploymentRecommendation: "DO_NOT_DEPLOY", verdictStatus: "not_ready" });
    expect(d?.action).toBe("analyze");
    expect(d?.nextAction).not.toMatch(/safe fix/i);
  });

  it("ready, current and clean -> no alert at all", () => {
    expect(
      derive({ deploymentRecommendation: "SHIP_IT", verdictStatus: "ready_to_ship" })
    ).toBeNull();
  });

  it("analysis_failed -> retry/review", () => {
    const d = derive({ verdictStatus: "analysis_failed" });
    expect(d?.action).toBe("retry");
    expect(d?.nextAction).not.toMatch(/safe fix/i);
  });

  it("review running -> wait", () => {
    const d = derive({ reviewInProgress: true, hasActionableFinding: true });
    expect(d?.action).toBe("wait");
    expect(d?.nextAction).toMatch(/wait/i);
    expect(d?.nextAction).not.toMatch(/safe fix/i);
  });

  it("stale verdict -> rescan (even for a ready verdict)", () => {
    const d = derive({
      deploymentRecommendation: "SHIP_IT",
      verdictStatus: "ready_to_ship",
      freshnessStatus: "stale",
    });
    expect(d?.action).toBe("rescan");
  });

  it("failed review -> review again", () => {
    const d = derive({ reviewFailed: true });
    expect(d?.action).toBe("review_failed");
  });

  it("never uses the 'is anything wrong' worry line for a state where nothing is confirmed wrong", () => {
    expect(derive()?.worryLine).toMatch(/nothing is confirmed wrong/i);
  });
});

describe("alerts are bound to the decision (scan) they describe", () => {
  it("encodes and recovers the scan id through the dedupe key", () => {
    const key = buildDeployAlertDedupeKey({ projectId: PROJECT, scanId: SCAN, action: "analyze" });
    expect(decisionScanIdFromDedupeKey(key)).toBe(SCAN);
  });

  it("legacy day-keyed alerts and other kinds are not bound to any scan", () => {
    expect(decisionScanIdFromDedupeKey(`${PROJECT}:deploy_blocked:2026-09-23`)).toBeNull();
    expect(decisionScanIdFromDedupeKey(`${PROJECT}:status:a:b:c`)).toBeNull();
    expect(decisionScanIdFromDedupeKey(null)).toBeNull();
  });

  it("a deploy alert for another scan, or for no scan, is historical; for the current scan it is not", () => {
    expect(isHistoricalAlert({ alertKind: "deploy_blocked", decisionScanId: OLD_SCAN }, SCAN)).toBe(true);
    expect(isHistoricalAlert({ alertKind: "deploy_blocked", decisionScanId: null }, SCAN)).toBe(true);
    expect(isHistoricalAlert({ alertKind: "deploy_blocked", decisionScanId: SCAN }, SCAN)).toBe(false);
  });

  it("with no known current decision, a deploy alert is never presented as current", () => {
    expect(isHistoricalAlert({ alertKind: "deploy_blocked", decisionScanId: SCAN }, null)).toBe(true);
  });

  it("non-decision alert kinds are never marked historical", () => {
    expect(isHistoricalAlert({ alertKind: "watch_stale", decisionScanId: null }, SCAN)).toBe(false);
  });
});

function alertRow(overrides: Record<string, unknown>) {
  return {
    id: `a-${Math.random().toString(36).slice(2)}`,
    organization_id: ORG,
    project_id: PROJECT,
    alert_kind: "deploy_blocked",
    severity: "medium",
    delivery_tier: "digest",
    state: "delivered",
    dedupe_key: `${PROJECT}:deploy_blocked:2026-09-23`,
    priority: 60,
    protection_impact: "Worth fixing before your next deploy.",
    title_plain: "Deploy check",
    body_plain: "",
    worry_line: "Not an emergency",
    changed_bullets: ["SequrAI is not comfortable with a deploy right now."],
    next_action: "Apply Safe Fix before you ship.",
    cta_type: "safe_fix",
    created_at: "2026-09-23T11:28:56.311737+00:00",
    read_at: null,
    acknowledged_at: null,
    ...overrides,
  };
}

describe("MCP alert surface marks superseded alerts historical", () => {
  it("the stale 'Apply Safe Fix' alert is historical and is not the primary alert or guidance", async () => {
    const admin = createFakeAdmin({ security_alerts: [alertRow({})] } as FakeTables);
    const surface = await loadMcpAlertSurface(admin as never, PROJECT, SCAN);

    expect(surface.openAlerts).toHaveLength(1);
    expect(surface.openAlerts[0].historical).toBe(true);
    expect(surface.primaryAlert).toBeNull();
    expect(surface.founderGuidance).toBeNull();
    expect(surface.shouldWorry).toBe(false);
  });

  it("an alert bound to the current scan is the primary alert", async () => {
    const admin = createFakeAdmin({
      security_alerts: [
        alertRow({
          dedupe_key: buildDeployAlertDedupeKey({ projectId: PROJECT, scanId: SCAN, action: "analyze" }),
          next_action: 'Say "Review my project"',
          cta_type: "review_again",
        }),
        alertRow({}),
      ],
    } as FakeTables);
    const surface = await loadMcpAlertSurface(admin as never, PROJECT, SCAN);

    expect(surface.primaryAlert?.ctaType).toBe("review_again");
    expect(surface.primaryAlert?.historical).toBe(false);
    expect(surface.openAlerts.filter((a) => a.historical)).toHaveLength(1);
  });

  it("can_i_deploy never leads with 'No — nothing urgent' unless the decision is a clean ship", async () => {
    const admin = createFakeAdmin({ security_alerts: [] } as FakeTables);
    const base = { project: { id: PROJECT }, summary: "I can't answer responsibly yet.", verdictScanId: SCAN };

    const insufficient = await enrichMcpToolResultWithAlerts(admin as never, "can_i_deploy", {
      ...base,
      deploymentRecommendation: "MORE_ANALYSIS_REQUIRED",
    });
    expect(insufficient.summary).not.toMatch(/nothing urgent/i);

    const ship = await enrichMcpToolResultWithAlerts(admin as never, "can_i_deploy", {
      ...base,
      summary: "YES.",
      deploymentRecommendation: "SHIP_IT",
    });
    expect(ship.summary).toMatch(/nothing urgent/i);
  });
});

describe("what_changed exposes the authoritative scan so its alerts are classified", () => {
  it("a legacy deploy alert is historical and not primary when what_changed supplies the current scan", async () => {
    const admin = createFakeAdmin({ security_alerts: [alertRow({})] } as FakeTables);
    const enriched = await enrichMcpToolResultWithAlerts(admin as never, "what_changed", {
      project: { id: PROJECT },
      summary: "WHAT CHANGED",
      verdictScanId: SCAN,
    });
    expect(enriched.alerts?.primaryAlert).toBeNull();
    expect(enriched.summary).not.toMatch(/why I alerted you/i);
  });
});

describe("evaluateDeployCheckAlert delivers a canonical, scan-bound alert", () => {
  it("insufficient_data creates a review alert bound to the scan, with no Safe Fix", async () => {
    const tables = { security_alerts: [], security_alert_events: [], projects: [] } as unknown as FakeTables;
    const admin = createFakeAdmin(tables);

    await evaluateDeployCheckAlert(admin as never, {
      organizationId: ORG,
      projectId: PROJECT,
      projectName: "P",
      decision: decision(),
    });

    const rows = tables.security_alerts as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].cta_type).toBe("review_again");
    expect(String(rows[0].next_action)).not.toMatch(/safe fix/i);
    expect(decisionScanIdFromDedupeKey(rows[0].dedupe_key as string)).toBe(SCAN);
  });

  it("a clean current ship creates no alert", async () => {
    const tables = { security_alerts: [], security_alert_events: [], projects: [] } as unknown as FakeTables;
    const admin = createFakeAdmin(tables);
    await evaluateDeployCheckAlert(admin as never, {
      organizationId: ORG,
      projectId: PROJECT,
      projectName: "P",
      decision: decision({ deploymentRecommendation: "SHIP_IT", verdictStatus: "ready_to_ship" }),
    });
    expect(tables.security_alerts).toHaveLength(0);
  });
});

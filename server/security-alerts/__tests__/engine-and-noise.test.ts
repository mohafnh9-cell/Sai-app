import { describe, expect, it } from "vitest";
import { buildProtectionAlertCandidates } from "@/server/security-alerts/alert-engine";
import { defaultSeverityForKind, severityProfile } from "@/server/security-alerts/severity";
import {
  duplicateSuppressionReason,
  passesMaterialGate,
  shouldDeliverAlert,
} from "@/server/security-alerts/noise-policy";
import type { AlertCandidate } from "@/server/security-alerts/types";
import type { ProtectionContext } from "@/server/continuous-protection/protection-context";

function mockCtx(overrides: Partial<ProtectionContext> = {}): ProtectionContext {
  return {
    organizationId: "org",
    projectId: "proj",
    cpEnabled: true,
    cpPaused: false,
    githubConnected: true,
    hasSuccessfulReview: true,
    lastCheckAt: new Date().toISOString(),
    consecutiveDailyFailures: 0,
    verdict: null,
    latestSnapshotStatus: "requires_attention",
    productionConfidence: 80,
    securityConfidence: 80,
    productionDelta7d: -12,
    securityDelta7d: 0,
    worries: ["Public route without auth"],
    openCritical: 1,
    openHigh: 0,
    deployAnswer: "no_go",
    ...overrides,
  };
}

describe("alert severity", () => {
  it("maps critical kinds to critical severity", () => {
    expect(defaultSeverityForKind("confidence_cliff")).toBe("critical");
    expect(severityProfile("critical").deliveryTier).toBe("immediate");
  });

  it("maps deploy_blocked to digest medium", () => {
    expect(defaultSeverityForKind("deploy_blocked")).toBe("medium");
    expect(severityProfile("medium").deliveryTier).toBe("digest");
  });
});

describe("noise policy", () => {
  it("suppresses low severity delivery", () => {
    const candidate: AlertCandidate = {
      alertKind: "deploy_blocked",
      severity: "low",
      deliveryTier: "digest",
      dedupeKey: "x",
      priority: 90,
      protectionImpact: "",
      titlePlain: "",
      bodyPlain: "",
      worryLine: "",
      changedBullets: [],
      nextAction: "",
      ctaType: null,
    };
    expect(shouldDeliverAlert(candidate)).toBe(false);
  });

  it("detects duplicate suppression", () => {
    expect(duplicateSuppressionReason(true, false)).toBe("duplicate_dedupe_key");
    expect(duplicateSuppressionReason(false, true)).toBe("cooldown_active");
  });

  it("material gate passes on confidence cliff", () => {
    expect(
      passesMaterialGate({
        hasMaterialEvent24h: false,
        statusRequiresAttention: false,
        openCritical: 0,
        confidenceDrop24h: 12,
      })
    ).toBe(true);
  });
});

describe("protection alert candidates", () => {
  it("creates status regression candidate from memory events", () => {
    const candidates = buildProtectionAlertCandidates(mockCtx(), {
      projectName: "App",
      events24h: [
        {
          type: "protection_status_updated",
          payload: { from: "protected", to: "requires_attention" },
          occurred_at: new Date().toISOString(),
        },
      ],
      snapshots48h: [
        {
          snapshot_date: new Date().toISOString().slice(0, 10),
          production_confidence: 82,
          security_confidence: 90,
          protection_status: "requires_attention",
        },
        {
          snapshot_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          production_confidence: 94,
          security_confidence: 90,
          protection_status: "protected",
        },
      ],
      statusEvents7d: [
        { payload: { from: "protected", to: "requires_attention" } },
      ],
    });
    expect(candidates.some((c) => c.alertKind === "protection_status_regression")).toBe(true);
    expect(candidates.some((c) => c.alertKind === "confidence_cliff")).toBe(true);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AlertCandidate } from "../types";

const notifyOwnerOfCriticalAlertMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../notify-owner", () => ({
  notifyOwnerOfCriticalAlert: (...args: unknown[]) => notifyOwnerOfCriticalAlertMock(...args),
}));

vi.mock("../noise-policy", () => ({
  shouldDeliverAlert: () => true,
  cooldownUntil: () => null,
  isWithinCooldown: () => false,
  duplicateSuppressionReason: () => "cooldown_active",
}));

vi.mock("../memory-bridge", () => ({
  appendAlertSentMemory: vi.fn().mockResolvedValue(undefined),
  buildAlertCopy: () => ({ titlePlain: "fallback title", bodyPlain: "fallback body" }),
}));

vi.mock("../severity", () => ({
  severityProfile: () => ({
    priority: 10,
    protectionImpact: "at_risk",
    founderWorryLine: "worry",
    founderAction: "act now",
  }),
}));

function candidate(overrides: Partial<AlertCandidate> = {}): AlertCandidate {
  return {
    alertKind: "unsafe_deployment_detected",
    severity: "critical",
    deliveryTier: "immediate",
    dedupeKey: "dedupe-1",
    priority: 10,
    protectionImpact: "at_risk",
    titlePlain: "Exposed credential found",
    bodyPlain: "body",
    worryLine: "worry",
    changedBullets: [],
    nextAction: "Apply Safe Fix",
    ctaType: "safe_fix",
    ...overrides,
  };
}

function adminMock(options?: { existingDedupe?: boolean }) {
  return {
    from: (table: string) => {
      if (table === "security_alerts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: options?.existingDedupe ? { id: "existing-alert", state: "delivered" } : null,
                    error: null,
                  }),
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "alert-new" }, error: null }),
            }),
          }),
        };
      }
      if (table === "security_alert_events") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    },
  };
}

describe("deliverAlertCandidate — critical email trigger (M7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("notifies the owner exactly once when a new critical alert is delivered", async () => {
    const { deliverAlertCandidate } = await import("../lifecycle");
    const admin = adminMock();

    const result = await deliverAlertCandidate(admin as never, {
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Acme App",
      candidate: candidate({ severity: "critical" }),
    });

    expect(result.delivered).toBe(true);
    expect(notifyOwnerOfCriticalAlertMock).toHaveBeenCalledTimes(1);
    expect(notifyOwnerOfCriticalAlertMock).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        alertId: "alert-new",
        titlePlain: "Exposed credential found",
      })
    );
  });

  it("does not notify the owner for a non-critical severity alert", async () => {
    const { deliverAlertCandidate } = await import("../lifecycle");
    const admin = adminMock();

    await deliverAlertCandidate(admin as never, {
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Acme App",
      candidate: candidate({ severity: "high" }),
    });

    expect(notifyOwnerOfCriticalAlertMock).not.toHaveBeenCalled();
  });

  it("does not notify again when the same alert already exists (dedupe short-circuits before the email step)", async () => {
    const { deliverAlertCandidate } = await import("../lifecycle");
    const admin = adminMock({ existingDedupe: true });

    const result = await deliverAlertCandidate(admin as never, {
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Acme App",
      candidate: candidate({ severity: "critical" }),
    });

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("duplicate_dedupe_key");
    expect(notifyOwnerOfCriticalAlertMock).not.toHaveBeenCalled();
  });
});

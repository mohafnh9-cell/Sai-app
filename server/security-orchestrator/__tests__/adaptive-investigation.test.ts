import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import type { SequrAIFinding } from "@/server/security-evidence/canonical-finding";

vi.mock("@/server/ai-red-team/authorization/dynamic-target-authorization-service", () => ({
  getDynamicTargetAuthorizationStatus: vi.fn(async () => ({ authorized: true, targetOrigin: "https://staging.example.com" })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function ssrfFinding(): SequrAIFinding {
  const now = new Date().toISOString();
  return {
    id: "f1",
    fingerprint: "f1",
    title: "SSRF via user-controlled URL",
    description: "d",
    category: "ssrf",
    severity: "high",
    confidence: "medium",
    exploitability: { level: "LOW", confidence: 0.3, evidenceIds: [] },
    verificationStatus: "POTENTIAL",
    sources: ["external_engine"],
    evidence: [],
    affectedFiles: ["app/proxy.ts"],
    affectedEndpoints: [],
    affectedAssets: [],
    remediation: null,
    references: [],
    cwe: ["CWE-918"],
    owasp: [],
    mitre: [],
    scanId: "scan-1",
    projectId: "project-1",
    organizationId: "org-1",
    createdAt: now,
    updatedAt: now,
  };
}

describe("Phase 36 -- runAdaptiveInvestigation (section 13/14/15)", () => {
  it("declines escalation and records an honest reason when real network enforcement is not active, even with an authorized target", async () => {
    vi.stubEnv("SECURITY_WORKER_NETWORK_ENFORCEMENT_VERIFIED", "");
    const { runAdaptiveInvestigation } = await import("../adaptive-investigation");
    const admin = createFakeAdmin({});

    const decisions = await runAdaptiveInvestigation(admin as never, {
      organizationId: "org-1",
      projectId: "project-1",
      findings: [ssrfFinding()],
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.escalated).toBe(false);
    expect(decisions[0]?.reason).toMatch(/network egress enforcement is not active/);
  });

  it("produces no investigation decisions when there are no trigger-class findings", async () => {
    const { runAdaptiveInvestigation } = await import("../adaptive-investigation");
    const admin = createFakeAdmin({});
    const decisions = await runAdaptiveInvestigation(admin as never, {
      organizationId: "org-1",
      projectId: "project-1",
      findings: [{ ...ssrfFinding(), category: "dependency" }],
    });
    expect(decisions).toHaveLength(0);
  });

  it("escalates ONLY when both real network enforcement AND an authorized target are confirmed", async () => {
    vi.stubEnv("SECURITY_WORKER_NETWORK_ENFORCEMENT_VERIFIED", "true");
    const { runAdaptiveInvestigation } = await import("../adaptive-investigation");
    const admin = createFakeAdmin({});

    const decisions = await runAdaptiveInvestigation(admin as never, {
      organizationId: "org-1",
      projectId: "project-1",
      findings: [ssrfFinding()],
    });

    expect(decisions[0]?.escalated).toBe(true);
  });
});

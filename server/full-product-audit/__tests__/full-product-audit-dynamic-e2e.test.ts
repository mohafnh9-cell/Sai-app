/**
 * Full Product Audit → Real Dynamic Testing E2E
 *
 * Proves the complete chain:
 * triggerProductionReview (already_completed) → scan_findings → attack selection
 * → resolveDynamicTargetForAudit → startAttackCampaign → real HTTP → correlation → MCP format
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/server", () => ({
  getTranslator: async () => {
    const map: Record<string, string> = {
      "tests.idor-cross-tenant.title": "Cross-tenant IDOR",
      "tests.idor-cross-tenant.description": "Tests cross-tenant access boundaries.",
      "tests.idor-cross-tenant.categoryLabel": "Authorization",
      "tests.unauthenticated-endpoint.title": "Unauthenticated endpoint",
      "tests.unauthenticated-endpoint.description": "Checks unauthenticated access.",
      "tests.unauthenticated-endpoint.categoryLabel": "Authentication",
      "tests.rate-limit-brute-force.title": "Rate limiting",
      "tests.rate-limit-brute-force.description": "Probes rate limiting behavior.",
      "tests.rate-limit-brute-force.categoryLabel": "Availability",
      "tests.security-headers-probe.title": "Security headers",
      "tests.security-headers-probe.description": "Inspects security headers.",
      "tests.security-headers-probe.categoryLabel": "Web",
      "tests.workflow-bypass.title": "Workflow bypass",
      "tests.workflow-bypass.description": "Workflow bypass probe.",
      "tests.workflow-bypass.categoryLabel": "Business logic",
      "tests.webhook-signature-bypass.title": "Webhook signature",
      "tests.webhook-signature-bypass.description": "Webhook signature probe.",
      "tests.webhook-signature-bypass.categoryLabel": "Web",
      "tests.double-credit-consumption.title": "Double credit",
      "tests.double-credit-consumption.description": "Double credit probe.",
      "tests.double-credit-consumption.categoryLabel": "Business logic",
      "tests.idempotency-replay.title": "Idempotency replay",
      "tests.idempotency-replay.description": "Idempotency replay probe.",
      "tests.idempotency-replay.categoryLabel": "Reliability",
    };
    const t = (key: string) => map[key] ?? key;
    return { t };
  },
}));
import { startDynamicSecurityLab, type DynamicSecurityLab } from "@/fixtures/dynamic-security-lab/server";
import { runFullProductAudit } from "../orchestrate";
import { formatFullProductAuditResponse } from "../format-response";
import { getMcpTranslator } from "@/server/mcp/i18n";
import {
  buildEvilAuthorization,
  buildReviewDeps,
  createFullProductAuditE2EAdmin,
  E2E_COMMIT_SHA,
  E2E_ORG_ID,
  E2E_PROJECT_ID,
} from "./e2e-harness";

let lab: DynamicSecurityLab;
const t = getMcpTranslator("en");

const savedInngest = {
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
};

beforeAll(async () => {
  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.INNGEST_SIGNING_KEY;
  delete process.env.SEQURAI_LAB_IDOR_PROTECTED;
  lab = await startDynamicSecurityLab();
});

afterAll(async () => {
  if (savedInngest.eventKey) process.env.INNGEST_EVENT_KEY = savedInngest.eventKey;
  else delete process.env.INNGEST_EVENT_KEY;
  if (savedInngest.signingKey) process.env.INNGEST_SIGNING_KEY = savedInngest.signingKey;
  else delete process.env.INNGEST_SIGNING_KEY;
  delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
  delete process.env.SEQURAI_LAB_IDOR_PROTECTED;
  await lab.close();
});

beforeEach(() => {
  delete process.env.SEQURAI_LAB_IDOR_PROTECTED;
  delete process.env.SEQURAI_DYNAMIC_LAB_IDOR_PATH;
});

async function runAudit(options?: {
  withLabTarget?: boolean;
  attackAuthorizations?: ReturnType<typeof buildEvilAuthorization>[];
}) {
  if (options?.withLabTarget !== false) {
    process.env.SEQURAI_DYNAMIC_LAB_ORIGIN = lab.origin;
  } else {
    delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
  }

  const { admin, tables } = createFullProductAuditE2EAdmin({
    attackAuthorizations: options?.attackAuthorizations,
  });

  const result = await runFullProductAudit(admin as never, {
    organizationId: E2E_ORG_ID,
    projectId: E2E_PROJECT_ID,
    projectName: "Dynamic Security E2E Lab",
    repositoryFullName: "sequrai/dynamic-security-e2e",
    githubRepo: "sequrai/dynamic-security-e2e",
    githubRepositoryId: 4242,
    commitSha: E2E_COMMIT_SHA,
    waitForReviewMs: 1_000,
    waitForSecurityTestsMs: 500,
    reviewDeps: buildReviewDeps(),
  });

  const formatted = formatFullProductAuditResponse(result, t);
  return { result, formatted, tables, admin };
}

describe("full_product_audit → real dynamic testing E2E", () => {
  it("TEST 1 — authorized lab target + vulnerable IDOR → CONFIRMED via full orchestration", async () => {
    const { result, formatted, tables } = await runAudit();

    expect(result.phase).toBe("complete");
    expect(result.engines.securityTesting.runtimeMode).toBe("sandbox");
    expect(result.engines.securityTesting.dynamicTargetSource).toBe("sandbox_lab");
    expect(result.engines.securityTesting.adaptersExecuted).toContain("idor-cross-tenant");

    const idorFinding = result.findings.find(
      (finding) =>
        finding.verificationStatus === "CONFIRMED" &&
        (finding.title.toLowerCase().includes("idor") ||
          finding.title.toLowerCase().includes("cross-tenant") ||
          finding.title.toLowerCase().includes("authorization"))
    );
    expect(idorFinding, "expected CONFIRMED correlated IDOR finding").toBeTruthy();

    expect(formatted.summary).toContain("STATIC ANALYSIS");
    expect(formatted.summary).toContain("DYNAMIC TESTING");
    expect(formatted.summary).toContain("SequrAI");

    const evidenceRows = tables.attack_simulation_evidence ?? [];
    expect(evidenceRows.length).toBeGreaterThan(0);
    const evidenceBlob = JSON.stringify(evidenceRows);
    expect(evidenceBlob.toLowerCase()).not.toMatch(/bearer test-token|authorization.*test-token/i);
    expect(evidenceBlob).toContain("127.0.0.1");

    const campaign = (tables.attack_simulation_campaigns ?? [])[0];
    expect(campaign?.runtime_mode).toBe("sandbox");
    expect(result.counts.confirmed).toBeGreaterThan(0);
  }, 60_000);

  it("TEST 2 — authorized lab + protected IDOR → not CONFIRMED for IDOR", async () => {
    process.env.SEQURAI_DYNAMIC_LAB_IDOR_PATH = "/api/orders/user-b-protected";
    const { result } = await runAudit();

    expect(result.engines.securityTesting.runtimeMode).toBe("sandbox");
    const idorCorrelated = result.findings.filter((finding) =>
      finding.title.toLowerCase().includes("cross-tenant") ||
      finding.title.toLowerCase().includes("authorization") ||
      finding.ruleId === "authz.insufficient"
    );
    expect(idorCorrelated.some((f) => f.verificationStatus === "CONFIRMED")).toBe(false);
    expect(
      idorCorrelated.some((f) =>
        f.verificationStatus === "FALSE_POSITIVE" || f.verificationStatus === "NOT_REPRODUCED"
      )
    ).toBe(true);
  }, 60_000);

  it("TEST 3 — no authorized dynamic target → static analysis only, dynamic skipped", async () => {
    const { result, formatted } = await runAudit({ withLabTarget: false });

    expect(result.engines.codeReview.findingsCount).toBeGreaterThan(0);
    expect(result.engines.securityTesting.runtimeMode).toBe("mock");
    expect(result.engines.securityTesting.dynamicTargetSource).toBe("none");
    expect(formatted.summary).toContain("STATIC ANALYSIS");
    expect(formatted.summary).toContain("DYNAMIC TESTING");
    expect(formatted.summary.toLowerCase()).toContain("no authorized target");
    expect(result.findings.some((f) => f.verificationStatus === "CONFIRMED")).toBe(false);
  }, 60_000);

  it("TEST 4 — out-of-scope external target → dynamic blocked, no CONFIRMED", async () => {
    const { result } = await runAudit({
      withLabTarget: false,
      attackAuthorizations: [buildEvilAuthorization()],
    });

    expect(result.engines.securityTesting.dynamicTargetSource).toBe("authorization");
    expect(result.engines.securityTesting.runtimeMode).toBe("authorized_staging");
    expect(result.findings.some((f) => f.verificationStatus === "CONFIRMED")).toBe(false);
  }, 60_000);

  it("TEST 5 — persisted evidence contains HTTP metadata without secrets", async () => {
    const { tables } = await runAudit();

    const evidenceRows = tables.attack_simulation_evidence ?? [];
    expect(evidenceRows.length).toBeGreaterThan(0);

    for (const row of evidenceRows) {
      const serialized = JSON.stringify(row).toLowerCase();
      expect(serialized).not.toContain("bearer test-token");
      expect(serialized).not.toContain("test-token-user-a");
      expect(row.project_id).toBe(E2E_PROJECT_ID);
      expect(row.organization_id).toBe(E2E_ORG_ID);
    }

    const findings = tables.attack_simulation_findings ?? [];
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.outcome === "confirmed")).toBe(true);
  }, 60_000);
});

describe("full_product_audit MCP entry shape", () => {
  it("formats audit like Audita mi producto without exposing adapter IDs", async () => {
    process.env.SEQURAI_DYNAMIC_LAB_ORIGIN = lab.origin;
    const { admin } = createFullProductAuditE2EAdmin();
    const result = await runFullProductAudit(admin as never, {
      organizationId: E2E_ORG_ID,
      projectId: E2E_PROJECT_ID,
      projectName: "Dynamic Security E2E Lab",
      repositoryFullName: "sequrai/dynamic-security-e2e",
      githubRepo: "sequrai/dynamic-security-e2e",
      githubRepositoryId: 4242,
      commitSha: E2E_COMMIT_SHA,
      waitForSecurityTestsMs: 500,
      reviewDeps: buildReviewDeps(),
    });

    const formatted = formatFullProductAuditResponse(result, t);
    expect(formatted.summary).toContain("SequrAI");
    expect(formatted.summary).not.toContain("idor-cross-tenant");
    expect(formatted.summary).toContain("Confirmed:");
  }, 60_000);
});

/**
 * Gate 2 — Full Product Audit E2E for remaining dynamic adapters.
 *
 * Each adapter is validated through the complete orchestration chain with real HTTP.
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
      "tests.webhook-signature-bypass.title": "Webhook signature",
      "tests.webhook-signature-bypass.description": "Webhook signature probe.",
      "tests.webhook-signature-bypass.categoryLabel": "Web",
      "tests.idempotency-replay.title": "Idempotency replay",
      "tests.idempotency-replay.description": "Idempotency replay probe.",
      "tests.idempotency-replay.categoryLabel": "Reliability",
      "tests.mass-assignment-probe.title": "Mass assignment",
      "tests.mass-assignment-probe.description": "Mass assignment probe.",
      "tests.mass-assignment-probe.categoryLabel": "Validation",
      "tests.privilege-escalation.title": "Privilege escalation",
      "tests.privilege-escalation.description": "Privilege escalation probe.",
      "tests.privilege-escalation.categoryLabel": "Authorization",
      "tests.injection-probe-safe.title": "Safe injection probe",
      "tests.injection-probe-safe.description": "Safe injection probe.",
      "tests.injection-probe-safe.categoryLabel": "Injection",
      "tests.ssrf-probe-safe.title": "Safe SSRF probe",
      "tests.ssrf-probe-safe.description": "Safe SSRF probe.",
      "tests.ssrf-probe-safe.categoryLabel": "Injection",
      "tests.cors-misconfiguration.title": "CORS misconfiguration",
      "tests.cors-misconfiguration.description": "CORS misconfiguration probe.",
      "tests.cors-misconfiguration.categoryLabel": "Web",
    };
    const t = (key: string) => map[key] ?? key;
    return { t };
  },
}));

import { startDynamicSecurityLab, type DynamicSecurityLab } from "@/fixtures/dynamic-security-lab/server";
import type { FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { getMcpTranslator } from "@/server/mcp/i18n";
import type { FindingVerificationStatus } from "../types";
import { runFullProductAudit } from "../orchestrate";
import { formatFullProductAuditResponse } from "../format-response";
import {
  ADAPTER_E2E_FIXTURES,
  scanFindingRow,
  type AdapterE2EFixture,
} from "./adapter-e2e-fixtures";
import {
  buildReviewDeps,
  createFullProductAuditE2EAdmin,
  E2E_COMMIT_SHA,
  E2E_ORG_ID,
  E2E_PROJECT_ID,
} from "./e2e-harness";

let lab: DynamicSecurityLab;
const t = getMcpTranslator("en");

const LAB_ENV_KEYS = [
  "SEQURAI_LAB_WEBHOOK_UNPROTECTED",
  "SEQURAI_LAB_MASS_ASSIGNMENT_PROTECTED",
  "SEQURAI_LAB_PRIVILEGE_ESCALATION_VULNERABLE",
  "SEQURAI_LAB_INJECTION_PROTECTED",
  "SEQURAI_LAB_SSRF_VULNERABLE",
  "SEQURAI_LAB_CORS_PROTECTED",
  "SEQURAI_LAB_IDOR_PROTECTED",
  "SEQURAI_DYNAMIC_LAB_IDOR_PATH",
  "SEQURAI_DYNAMIC_LAB_IDEMPOTENCY_PATH",
  "SEQURAI_DYNAMIC_LAB_SECURITY_HEADERS_PATH",
  "SEQURAI_DYNAMIC_LAB_WEBHOOK_PATH",
  "SEQURAI_DYNAMIC_LAB_MASS_ASSIGNMENT_PATH",
  "SEQURAI_DYNAMIC_LAB_PRIVILEGE_ESCALATION_PATH",
  "SEQURAI_DYNAMIC_LAB_INJECTION_PATH",
  "SEQURAI_DYNAMIC_LAB_SSRF_PATH",
  "SEQURAI_DYNAMIC_LAB_CORS_PATH",
] as const;

const savedInngest = {
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
};

beforeAll(async () => {
  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.INNGEST_SIGNING_KEY;
  lab = await startDynamicSecurityLab();
});

afterAll(async () => {
  if (savedInngest.eventKey) process.env.INNGEST_EVENT_KEY = savedInngest.eventKey;
  else delete process.env.INNGEST_EVENT_KEY;
  if (savedInngest.signingKey) process.env.INNGEST_SIGNING_KEY = savedInngest.signingKey;
  else delete process.env.INNGEST_SIGNING_KEY;
  delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
  for (const key of LAB_ENV_KEYS) delete process.env[key];
  await lab.close();
});

beforeEach(() => {
  for (const key of LAB_ENV_KEYS) delete process.env[key];
  lab.resetState();
});

function applyEnv(env?: Record<string, string>) {
  for (const key of LAB_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env ?? {})) {
    process.env[key] = value;
  }
}

async function runAdapterAudit(fixture: AdapterE2EFixture, mode: "vulnerable" | "protected") {
  const labEnv = mode === "vulnerable" ? fixture.vulnerableLabEnv : fixture.protectedLabEnv;
  const fixtureEnv =
    mode === "vulnerable" ? fixture.vulnerableFixtureEnv : fixture.protectedFixtureEnv;
  applyEnv({ ...labEnv, ...fixtureEnv });
  process.env.SEQURAI_DYNAMIC_LAB_ORIGIN = lab.origin;

  const { admin, tables } = createFullProductAuditE2EAdmin({
    scanFindings: [scanFindingRow(fixture.staticFinding)],
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
  return { result, formatted, tables };
}

function expectAdapterE2EResult(
  result: Awaited<ReturnType<typeof runAdapterAudit>>["result"],
  tables: FakeTables,
  input: {
    adapterId: string;
    staticFindingId: string;
    verificationStatus: FindingVerificationStatus;
  }
) {
  expect(result.phase).toBe("complete");
  expect(result.engines.securityTesting.runtimeMode).toBe("sandbox");
  expect(result.engines.securityTesting.dynamicTargetSource).toBe("sandbox_lab");
  expect(result.engines.securityTesting.adaptersExecuted).toContain(input.adapterId);
  expect(result.engines.securityTesting.adaptersSelectedFromFindings).toContain(input.adapterId);

  const correlated = result.findings.find(
    (finding) =>
      finding.staticFindingId === input.staticFindingId &&
      finding.source === "both" &&
      (finding.adapterId === input.adapterId ||
        finding.evidence.some((line) => line.includes(`Dynamic (${input.adapterId})`)))
  );
  expect(correlated, `expected correlated ${input.adapterId} finding`).toBeTruthy();
  expect(correlated!.verificationStatus).toBe(input.verificationStatus);
  expect(correlated!.evidence.some((line) => line.startsWith("Static:"))).toBe(true);
  expect(correlated!.evidence.some((line) => line.startsWith("Dynamic ("))).toBe(true);

  const evidenceRows = tables.attack_simulation_evidence ?? [];
  expect(evidenceRows.length).toBeGreaterThan(0);
  const evidenceBlob = JSON.stringify(evidenceRows);
  expect(evidenceBlob).toContain("127.0.0.1");
  expect(evidenceBlob.toLowerCase()).not.toMatch(/bearer test-token-user-a/);
}

const REMAINING_ADAPTERS = [
  "webhook-signature-bypass",
  "idempotency-replay",
  "mass-assignment-probe",
  "privilege-escalation",
  "security-headers-probe",
  "injection-probe-safe",
  "ssrf-probe-safe",
  "cors-misconfiguration",
] as const;

describe("Gate 2 — full_product_audit adapter E2E (real HTTP)", () => {
  for (const adapterId of REMAINING_ADAPTERS) {
    const fixture = ADAPTER_E2E_FIXTURES[adapterId];

    describe(adapterId, () => {
      it("TEST A — vulnerable fixture → CONFIRMED via full orchestration", async () => {
        const { result, tables } = await runAdapterAudit(fixture, "vulnerable");
        expectAdapterE2EResult(result, tables, {
          adapterId,
          staticFindingId: fixture.staticFinding.id,
          verificationStatus: "CONFIRMED",
        });
      }, 60_000);

      it("TEST B — protected fixture → not CONFIRMED", async () => {
        const { result, tables } = await runAdapterAudit(fixture, "protected");
        expect(result.engines.securityTesting.adaptersExecuted).toContain(adapterId);

        const correlated = result.findings.find(
          (finding) =>
            finding.staticFindingId === fixture.staticFinding.id &&
            finding.source === "both" &&
            (finding.adapterId === adapterId ||
              finding.evidence.some((line) => line.includes(`Dynamic (${adapterId})`)))
        );
        expect(correlated).toBeTruthy();
        expect(correlated!.verificationStatus).toBe("FALSE_POSITIVE");

        const evidenceBlob = JSON.stringify(tables.attack_simulation_evidence ?? []);
        expect(evidenceBlob).toContain("127.0.0.1");
      }, 60_000);
    });
  }

  it("MCP response hides adapter IDs while showing static vs dynamic sections", async () => {
    const fixture = ADAPTER_E2E_FIXTURES["mass-assignment-probe"];
    applyEnv(fixture.vulnerableLabEnv);
    process.env.SEQURAI_DYNAMIC_LAB_ORIGIN = lab.origin;

    const { admin } = createFullProductAuditE2EAdmin({
      scanFindings: [scanFindingRow(fixture.staticFinding)],
    });
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
    expect(formatted.summary).toContain("SECURITY STATUS");
    expect(formatted.summary).toContain("DYNAMIC TESTING");
    expect(formatted.summary).not.toContain("mass-assignment-probe");
  }, 60_000);
});

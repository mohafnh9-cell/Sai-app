import { describe, expect, it } from "vitest";
import {
  MAIN_CERTIFICATION_CONFIRMATION_VALUE,
  evaluateMainCertificationGate,
  evaluateMainCertificationPreflight,
  evaluateStagingCertificationGate,
  isBlockedProductionExecution,
  validateCertificationProjectRecord,
} from "../../../scripts/lib/platform-convergence-certification.mjs";

const BASE_MAIN_ENV = {
  ALLOW_MAIN_CERTIFICATION: "1",
  MAIN_CERTIFICATION_CONFIRMATION: MAIN_CERTIFICATION_CONFIRMATION_VALUE,
  STAGING_CERT_ORG_ID: "org-cert-1",
  STAGING_CERT_PROJECT_ID: "proj-cert-1",
  CERTIFICATION_PROJECT_IDS: "proj-cert-1",
  MAIN_CERTIFICATION_URL: "https://sequrai-app.vercel.app",
  NEXT_PUBLIC_APP_URL: "https://sequrai-app.vercel.app",
  CERTIFICATION_FIXTURE_REPOSITORIES: "my-org/platform-convergence-fixture",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  FEATURE_RT9_BUSINESS_LOGIC: "1",
};

describe("main certification guards", () => {
  it("blocks main execution without ALLOW_MAIN_CERTIFICATION", () => {
    const gate = evaluateMainCertificationGate({
      ...BASE_MAIN_ENV,
      ALLOW_MAIN_CERTIFICATION: "0",
    });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => e.includes("ALLOW_MAIN_CERTIFICATION"))).toBe(true);
  });

  it("blocks main execution without exact confirmation phrase", () => {
    const gate = evaluateMainCertificationGate({
      ...BASE_MAIN_ENV,
      MAIN_CERTIFICATION_CONFIRMATION: "WRONG",
    });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => e.includes("MAIN_CERTIFICATION_CONFIRMATION"))).toBe(true);
  });

  it("blocks main execution when fault injection is enabled", () => {
    const gate = evaluateMainCertificationGate({
      ...BASE_MAIN_ENV,
      ALLOW_PLATFORM_CONVERGENCE_FAULT_INJECTION: "1",
    });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => e.toLowerCase().includes("fault injection"))).toBe(true);
  });

  it("blocks project outside certification scope", () => {
    const record = validateCertificationProjectRecord(
      {
        id: "other-project",
        organization_id: "org-cert-1",
        name: "[CERT] Fixture",
        github_repo: "https://github.com/my-org/platform-convergence-fixture",
      },
      BASE_MAIN_ENV
    );
    expect(record.ok).toBe(false);
    expect(record.errors.some((e) => e.includes("CERTIFICATION_PROJECT_IDS"))).toBe(true);
  });

  it("allows Scenario A preflight with all safeguards", () => {
    const pre = evaluateMainCertificationPreflight(BASE_MAIN_ENV, { skipFlagCheck: true });
    expect(pre.ok).toBe(true);
    expect(pre.certificationEnvironment).toBe("main");
  });
});

describe("staging certification guards", () => {
  it("blocks staging when APP URL matches production host pattern", () => {
    const block = isBlockedProductionExecution(
      {
        NEXT_PUBLIC_APP_URL: "https://app.sequrai.com",
        STAGING_BASE_URL: "https://staging.example.com",
      },
      "staging"
    );
    expect(block.blocked).toBe(true);
  });

  it("does not use NODE_ENV alone as production block for staging URL check", () => {
    const block = isBlockedProductionExecution(
      {
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://staging.example.com",
        STAGING_BASE_URL: "https://staging.example.com",
      },
      "staging"
    );
    expect(block.blocked).toBe(false);
  });

  it("staging gate still requires STAGING_BASE_URL", () => {
    const staging = evaluateStagingCertificationGate(
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "k",
        STAGING_CERT_ORG_ID: "o",
        STAGING_CERT_PROJECT_ID: "p",
        NEXT_PUBLIC_APP_URL: "https://staging.example.com",
      },
      { skipFlagCheck: true }
    );
    expect(staging.ok).toBe(false);
    expect(staging.missing).toContain("STAGING_BASE_URL");
    expect(staging.certificationEnvironment).toBe("staging");
  });
});

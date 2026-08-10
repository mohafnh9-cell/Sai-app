import { describe, expect, it } from "vitest";
import {
  validateAttackPreconditions,
  type PreconditionValidationInput,
} from "@/server/attack-simulation";

describe("attack preconditions", () => {
  const baseCampaign = {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "66666666-6666-4666-8666-666666666666",
    projectId: "55555555-5555-4555-8555-555555555555",
    commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
    authorizationId: null as string | null,
  };

  function validate(
    overrides: Partial<PreconditionValidationInput["campaign"]> & {
      authorization?: PreconditionValidationInput["authorization"];
      targetUrl?: string | null;
    }
  ) {
    const { authorization, targetUrl, ...campaignOverrides } = overrides;
    return validateAttackPreconditions({
      campaign: { ...baseCampaign, runtimeMode: "mock", ...campaignOverrides },
      authorization,
      targetUrl,
    });
  }

  it("allows mock runtime without external authorization", () => {
    const result = validate({ runtimeMode: "mock" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.effectiveRuntimeMode).toBe("mock");
  });

  it("blocks unsupported and blocked runtime modes", () => {
    expect(validate({ runtimeMode: "blocked" }).ok).toBe(false);
    expect(validate({ runtimeMode: "unsupported" }).ok).toBe(false);
  });

  it("requires authorization for authorized_staging runtime", () => {
    const result = validate({ runtimeMode: "authorized_staging", authorizationId: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureCode).toBe("authorization_present");
  });

  it("validates authorized staging target origin and tenant", () => {
    const now = Date.now();
    const result = validateAttackPreconditions({
      campaign: {
        ...baseCampaign,
        runtimeMode: "authorized_staging",
        authorizationId: "77777777-7777-4777-8777-777777777777",
      },
      authorization: {
        id: "77777777-7777-4777-8777-777777777777",
        organizationId: baseCampaign.organizationId,
        projectId: baseCampaign.projectId,
        targetOrigin: "https://staging.example.com",
        environmentType: "staging",
        status: "approved",
        authorizationMethod: "manual",
        approvedScope: {},
        createdBy: null,
        approvedAt: new Date(now - 60_000).toISOString(),
        expiresAt: new Date(now + 3_600_000).toISOString(),
        testCredentialsRef: null,
        pathExclusions: [],
        redirectAllowlist: [],
        maxRequestBudget: 100,
        maxDurationSeconds: 900,
        commitSha: baseCampaign.commitSha,
      },
      targetUrl: "https://staging.example.com/api/health",
    });

    expect(result.ok).toBe(true);
  });

  it("rejects external targets for internal runtimes", () => {
    const result = validate({
      runtimeMode: "mock",
      targetUrl: "https://staging.example.com/api",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureCode).toBe("external_target_disallowed");
  });

  it("allows allowlisted sandbox targets", () => {
    const result = validate({
      runtimeMode: "sandbox",
      targetUrl: "http://127.0.0.1:4242/api/health",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects non-allowlisted sandbox targets", () => {
    const result = validate({
      runtimeMode: "sandbox",
      targetUrl: "https://evil.example.com/api",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureCode).toBe("sandbox_target_allowlisted");
  });

  it("rejects commit sha mismatch against authorization", () => {
    const now = Date.now();
    const result = validateAttackPreconditions({
      campaign: {
        ...baseCampaign,
        runtimeMode: "authorized_staging",
        authorizationId: "77777777-7777-4777-8777-777777777777",
        commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      authorization: {
        id: "77777777-7777-4777-8777-777777777777",
        organizationId: baseCampaign.organizationId,
        projectId: baseCampaign.projectId,
        targetOrigin: "https://staging.example.com",
        environmentType: "staging",
        status: "approved",
        authorizationMethod: "manual",
        approvedScope: {},
        createdBy: null,
        approvedAt: new Date(now - 60_000).toISOString(),
        expiresAt: new Date(now + 3_600_000).toISOString(),
        testCredentialsRef: null,
        pathExclusions: [],
        redirectAllowlist: [],
        maxRequestBudget: 100,
        maxDurationSeconds: 900,
        commitSha: baseCampaign.commitSha,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureCode).toBe("authorization_commit_match");
  });
});

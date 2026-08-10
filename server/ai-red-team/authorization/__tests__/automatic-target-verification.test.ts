import { describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import {
  attemptAutomaticVerification,
  authorizeAndCheckDynamicTarget,
} from "../dynamic-target-authorization-service";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function deploymentEvidence(origin: string) {
  return {
    method: "deployment_repository_match" as const,
    provider: "vercel" as const,
    deploymentId: 9001,
    matchedOrigin: origin,
    observedAt: "2026-08-10T12:00:00.000Z",
    deploymentEnvironment: "preview" as const,
  };
}

function authorizationRow(input: {
  origin: string;
  environment: "preview" | "staging" | "production_safe";
}) {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    organization_id: ORG_ID,
    project_id: PROJECT_ID,
    target_origin: input.origin,
    environment_type: input.environment,
    status: "approved",
    authorization_method: "authenticated_deployment_verified",
    approved_scope: { allowedPaths: ["/"] },
    created_by: USER_ID,
    approved_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    test_credentials_ref: null,
    path_exclusions: [],
    redirect_allowlist: [],
    max_request_budget: 50,
    max_duration_seconds: 300,
    commit_sha: null,
  };
}

describe("automatic target verification strategy", () => {
  it("records authenticated deployment evidence before approving the target", async () => {
    const tables: FakeTables = {
      attack_authorizations: [],
      dynamic_target_verifications: [],
    };
    const verifyDeploymentOwnership = vi.fn(async () => ({
      status: "verified" as const,
      evidence: deploymentEvidence("https://app.vercel.app"),
    }));

    const result = await authorizeAndCheckDynamicTarget(
      createFakeAdmin(tables) as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://app.vercel.app",
        environmentType: "staging",
        createdBy: USER_ID,
      },
      { verifyDeploymentOwnership }
    );

    expect(result).toMatchObject({
      authorized: true,
      verificationMethod: "deployment_repository_match",
      targetOrigin: "https://app.vercel.app",
    });
    expect(tables.dynamic_target_verifications[0]).toMatchObject({
      organization_id: ORG_ID,
      project_id: PROJECT_ID,
      verification_method: "deployment_repository_match",
      status: "verified",
    });
    expect(tables.attack_authorizations[0]).toMatchObject({
      organization_id: ORG_ID,
      project_id: PROJECT_ID,
      target_origin: "https://app.vercel.app",
      status: "approved",
      authorization_method: "authenticated_deployment_verified",
    });
  });

  it("supports a custom domain only when provider evidence proves the exact origin", async () => {
    const tables: FakeTables = {
      attack_authorizations: [],
      dynamic_target_verifications: [],
    };

    const result = await attemptAutomaticVerification(
      createFakeAdmin(tables) as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://app.example.com",
        createdBy: USER_ID,
      },
      {
        verifyDeploymentOwnership: vi.fn(async () => ({
          status: "verified" as const,
          evidence: deploymentEvidence("https://app.example.com"),
        })),
      }
    );

    expect(result).toMatchObject({
      verified: true,
      method: "deployment_repository_match",
      targetOrigin: "https://app.example.com",
    });
  });

  it("provides a safe boundary for a future authenticated Vercel integration", async () => {
    const tables: FakeTables = {
      attack_authorizations: [],
      dynamic_target_verifications: [],
    };

    const result = await attemptAutomaticVerification(
      createFakeAdmin(tables) as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://custom.example.com",
        createdBy: USER_ID,
      },
      {
        verifyDeploymentOwnership: vi.fn(async () => ({ status: "not_found" as const })),
        verifyProviderOwnership: vi.fn(async () => ({
          method: "provider_integration",
          provider: "vercel",
          providerProjectId: "prj_123",
          matchedOrigin: "https://custom.example.com",
          observedAt: "2026-08-10T12:00:00.000Z",
          deploymentEnvironment: "preview",
        })),
      }
    );

    expect(result).toMatchObject({
      verified: true,
      method: "provider_integration",
      targetOrigin: "https://custom.example.com",
    });
    expect(tables.dynamic_target_verifications[0]).toMatchObject({
      verification_method: "provider_integration",
      verification_evidence: expect.objectContaining({
        provider: "vercel",
        providerProjectId: "prj_123",
      }),
    });
  });

  it("creates the existing manual fallback only after automatic strategies fail", async () => {
    const tables: FakeTables = {
      attack_authorizations: [],
      dynamic_target_verifications: [],
    };

    const result = await authorizeAndCheckDynamicTarget(
      createFakeAdmin(tables) as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://unproven.example.com",
        environmentType: "staging",
        createdBy: USER_ID,
      },
      { verifyDeploymentOwnership: vi.fn(async () => ({ status: "not_found" as const })) }
    );

    expect(result).toMatchObject({
      authorized: false,
      manualVerificationRequired: true,
      reason: "manual_verification_required",
    });
    expect(tables.attack_authorizations).toHaveLength(0);
    expect(tables.dynamic_target_verifications[0]).toMatchObject({
      target_origin: "https://unproven.example.com",
      verification_method: "http",
      status: "pending",
    });
  });

  it("verifies ownership but refuses to authorize a production deployment", async () => {
    const tables: FakeTables = {
      attack_authorizations: [],
      dynamic_target_verifications: [],
    };
    const productionEvidence = {
      ...deploymentEvidence("https://app.vercel.app"),
      deploymentEnvironment: "production" as const,
    };

    const result = await authorizeAndCheckDynamicTarget(
      createFakeAdmin(tables) as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://app.vercel.app",
        environmentType: "staging",
        createdBy: USER_ID,
      },
      {
        verifyDeploymentOwnership: vi.fn(async () => ({
          status: "production_blocked" as const,
          evidence: productionEvidence,
        })),
      }
    );

    expect(result).toMatchObject({
      authorized: false,
      manualVerificationRequired: false,
      reason: "production_target_not_supported",
    });
    expect(tables.attack_authorizations).toHaveLength(0);
  });

  it("does not reuse a Production authorization for a Preview target", async () => {
    const tables: FakeTables = {
      attack_authorizations: [
        authorizationRow({
          origin: "https://app.vercel.app",
          environment: "production_safe",
        }),
      ],
      dynamic_target_verifications: [],
    };

    const result = await attemptAutomaticVerification(
      createFakeAdmin(tables) as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://app.vercel.app",
        environmentType: "preview",
        createdBy: USER_ID,
      },
      { verifyDeploymentOwnership: vi.fn(async () => ({ status: "not_found" as const })) }
    );

    expect(result).toMatchObject({
      verified: false,
      reason: "manual_verification_required",
    });
  });

  it("does not reuse an authorization issued for another exact origin", async () => {
    const tables: FakeTables = {
      attack_authorizations: [
        authorizationRow({
          origin: "https://production.example.com",
          environment: "preview",
        }),
      ],
      dynamic_target_verifications: [],
    };

    const result = await attemptAutomaticVerification(
      createFakeAdmin(tables) as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://preview.example.com",
        environmentType: "preview",
        createdBy: USER_ID,
      },
      { verifyDeploymentOwnership: vi.fn(async () => ({ status: "not_found" as const })) }
    );

    expect(result).toMatchObject({
      verified: false,
      targetOrigin: "https://preview.example.com",
    });
  });

  it("reuses an existing unexpired verification without provider access", async () => {
    const tables: FakeTables = {
      attack_authorizations: [],
      dynamic_target_verifications: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          organization_id: ORG_ID,
          project_id: PROJECT_ID,
          target_origin: "https://verified.example.com",
          verification_token: "sequrai-verify-existing",
          verification_method: "http",
          verification_evidence: {},
          status: "verified",
          created_by: USER_ID,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          verified_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ],
    };

    const result = await attemptAutomaticVerification(
      createFakeAdmin(tables) as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://verified.example.com",
        createdBy: USER_ID,
      },
      { verifyDeploymentOwnership: vi.fn(async () => ({ status: "not_found" as const })) }
    );

    expect(result).toMatchObject({
      verified: true,
      method: "existing_verification",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { authorizeDynamicTarget } from "../tools/authorize-dynamic-target";
import { parseTargetOriginFromUserText } from "@/server/ai-red-team/authorization/dynamic-target-authorization-service";
import { verifyTargetFromAuthenticatedGitHubDeployments } from "@/server/ai-red-team/authorization/github-deployment-ownership";
import { testMcpAuthContext } from "./test-context";

vi.mock("@/server/ai-red-team/authorization/github-deployment-ownership", () => ({
  verifyTargetFromAuthenticatedGitHubDeployments: vi.fn(),
}));

const E2E_ORG_ID = "66666666-6666-4666-8666-666666666666";
const E2E_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const t = getMcpTranslator("en");

describe("authorize_dynamic_target MCP tool", () => {
  beforeEach(() => {
    vi.mocked(verifyTargetFromAuthenticatedGitHubDeployments).mockResolvedValue({
      status: "not_found",
    });
  });

  it("returns not authorized status without exposing internal ids", async () => {
    const admin = createFakeAdmin({
      projects: [
        {
          id: E2E_PROJECT_ID,
          name: "Demo",
          organization_id: E2E_ORG_ID,
          github_repo: "sequrai/demo",
        },
      ],
      attack_authorizations: [],
      dynamic_target_verifications: [],
    });

    const result = await authorizeDynamicTarget(
      testMcpAuthContext(admin, { organizationId: E2E_ORG_ID, userId: "user-1" }),
      { projectId: E2E_PROJECT_ID, action: "status" },
      t
    );

    expect(result.application?.verified).toBe(false);
    expect(result.summary).toContain("Security verification");
    expect(JSON.stringify(result)).not.toMatch(/campaignId|adapterId|attack_simulation|authorizationId|maxRequestBudget|allowedPaths/);
  });

  it("parses target URL from natural language hint only for authorization tool", () => {
    expect(parseTargetOriginFromUserText("Quiero auditar https://staging.acme.com")).toBe(
      "https://staging.acme.com"
    );
    expect(parseTargetOriginFromUserText("sin url")).toBeNull();
  });

  it("uses one simple fallback action without exposing manual proof details", async () => {
    const admin = createFakeAdmin({
      projects: [
        {
          id: E2E_PROJECT_ID,
          name: "Demo",
          organization_id: E2E_ORG_ID,
          github_repo: "sequrai/demo",
        },
      ],
      attack_authorizations: [],
      dynamic_target_verifications: [],
    });

    const result = await authorizeDynamicTarget(
      testMcpAuthContext(admin, { organizationId: E2E_ORG_ID, userId: "user-1" }),
      {
        projectId: E2E_PROJECT_ID,
        action: "authorize_and_check",
        targetOrigin: "https://unproven.example.com",
      },
      t
    );

    expect(result.manualVerificationRequired).toBe(true);
    expect(result.summary).toContain("one final confirmation");
    expect(result.summary).toContain("Verify application");
    expect(result.summary).not.toMatch(
      /sequrai-verify-|\.well-known|DNS TXT|authorizationId|pending|approved|Gate 3|runtime/i
    );
  });

  it("treats a submitted URL as a candidate and does not authorize it without evidence", async () => {
    const tables: FakeTables = {
      projects: [
        {
          id: E2E_PROJECT_ID,
          name: "Demo",
          organization_id: E2E_ORG_ID,
          github_repo: "sequrai/demo",
        },
      ],
      attack_authorizations: [],
      dynamic_target_verifications: [],
    };
    const admin = createFakeAdmin(tables);

    const result = await authorizeDynamicTarget(
      testMcpAuthContext(admin, { organizationId: E2E_ORG_ID, userId: "user-1" }),
      {
        projectId: E2E_PROJECT_ID,
        action: "check",
        targetOrigin: "https://external.example.com",
      },
      t
    );

    expect(result.application).toMatchObject({
      verified: false,
      url: "https://external.example.com",
    });
    expect(result.manualVerificationRequired).toBe(true);
    expect(tables.attack_authorizations).toHaveLength(0);
    expect(tables.dynamic_target_verifications).toHaveLength(0);
  });

  it("action=check records exact Preview ownership without authorizing attacks", async () => {
    vi.mocked(verifyTargetFromAuthenticatedGitHubDeployments).mockResolvedValue({
      status: "verified",
      evidence: {
        method: "deployment_repository_match",
        provider: "vercel",
        deploymentId: 5746851970,
        matchedOrigin: "https://preview.example.com",
        observedAt: "2026-08-10T12:00:00.000Z",
        deploymentEnvironment: "preview",
      },
    });
    const tables: FakeTables = {
      projects: [
        {
          id: E2E_PROJECT_ID,
          name: "Demo",
          organization_id: E2E_ORG_ID,
          github_repo: "sequrai/demo",
        },
      ],
      attack_authorizations: [],
      dynamic_target_verifications: [],
    };

    const result = await authorizeDynamicTarget(
      testMcpAuthContext(createFakeAdmin(tables), { organizationId: E2E_ORG_ID, userId: "user-1" }),
      {
        projectId: E2E_PROJECT_ID,
        action: "check",
        targetOrigin: "https://preview.example.com",
        environmentType: "preview",
      },
      t
    );

    expect(result.application).toEqual({
      verified: true,
      url: "https://preview.example.com",
    });
    expect(result.authorized).toBe(false);
    expect(tables.attack_authorizations).toHaveLength(0);
    expect(tables.dynamic_target_verifications[0]).toMatchObject({
      target_origin: "https://preview.example.com",
      status: "verified",
    });
  });

  it("action=authorize_and_check continues through the existing authorization service", async () => {
    vi.mocked(verifyTargetFromAuthenticatedGitHubDeployments).mockResolvedValue({
      status: "verified",
      evidence: {
        method: "deployment_repository_match",
        provider: "vercel",
        deploymentId: 5746851970,
        matchedOrigin: "https://preview.example.com",
        observedAt: "2026-08-10T12:00:00.000Z",
        deploymentEnvironment: "preview",
      },
    });
    const tables: FakeTables = {
      projects: [
        {
          id: E2E_PROJECT_ID,
          name: "Demo",
          organization_id: E2E_ORG_ID,
          github_repo: "sequrai/demo",
        },
      ],
      attack_authorizations: [],
      dynamic_target_verifications: [],
    };

    const result = await authorizeDynamicTarget(
      testMcpAuthContext(createFakeAdmin(tables), { organizationId: E2E_ORG_ID, userId: "user-1" }),
      {
        projectId: E2E_PROJECT_ID,
        action: "authorize_and_check",
        targetOrigin: "https://preview.example.com",
        environmentType: "preview",
      },
      t
    );

    expect(result.authorized).toBe(true);
    expect(tables.attack_authorizations[0]).toMatchObject({
      target_origin: "https://preview.example.com",
      environment_type: "preview",
      status: "approved",
      authorization_method: "authenticated_deployment_verified",
    });
  });

  it("automatically approves a previously verified application", async () => {
    const now = new Date();
    const admin = createFakeAdmin({
      projects: [
        {
          id: E2E_PROJECT_ID,
          name: "Demo",
          organization_id: E2E_ORG_ID,
          github_repo: "sequrai/demo",
        },
      ],
      attack_authorizations: [],
      dynamic_target_verifications: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          organization_id: E2E_ORG_ID,
          project_id: E2E_PROJECT_ID,
          target_origin: "https://verified.example.com",
          verification_token: "sequrai-verify-existing",
          verification_method: "http",
          verification_evidence: {},
          status: "verified",
          created_by: "user-1",
          expires_at: new Date(now.getTime() + 60_000).toISOString(),
          verified_at: now.toISOString(),
          created_at: now.toISOString(),
        },
      ],
    });

    const result = await authorizeDynamicTarget(
      testMcpAuthContext(admin, { organizationId: E2E_ORG_ID, userId: "user-1" }),
      {
        projectId: E2E_PROJECT_ID,
        action: "authorize_and_check",
        targetOrigin: "https://verified.example.com",
      },
      t
    );

    expect(result.authorized).toBe(true);
    expect(result.summary).toContain("Application verified");
    expect(result.nextAction).toContain("Full Product Audit");
  });
});

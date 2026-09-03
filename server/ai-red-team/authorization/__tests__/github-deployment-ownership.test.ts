import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { resolveGitHubCredential } from "@/server/github-app/credential-provider";
import { verifyTargetFromAuthenticatedGitHubDeployments } from "../github-deployment-ownership";

vi.mock("@/server/github-app/credential-provider", () => ({
  resolveGitHubCredential: vi.fn(),
}));

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function adminWithProject(organizationId = ORG_ID) {
  return createFakeAdmin({
    projects: [
      {
        id: PROJECT_ID,
        organization_id: organizationId,
        github_repo: "https://github.com/acme/app",
        github_repository_id: 42,
      },
    ],
  });
}

function githubFetchFor(
  environmentUrl: string,
  creator = "vercel[bot]",
  environment = "Preview"
) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/deployments?")) {
      return new Response(JSON.stringify([{ id: 9001, environment }]), { status: 200 });
    }
    if (url.includes("/deployments/9001/statuses")) {
      return new Response(
        JSON.stringify([
          {
            state: "success",
            environment_url: environmentUrl,
            target_url: environmentUrl,
            created_at: "2026-08-10T12:00:00.000Z",
            creator: { login: creator, type: "Bot" },
          },
        ]),
        { status: 200 }
      );
    }
    return new Response("Not found", { status: 404 });
  });
}

describe("authenticated GitHub deployment ownership", () => {
  beforeEach(() => {
    vi.mocked(resolveGitHubCredential).mockResolvedValue({
      token: "github-token",
      userId: "user-1",
      source: "oauth_legacy",
      connectionId: "connection-1",
      githubInstallationId: null,
    });
  });

  it("verifies an exact Vercel deployment URL from the connected repository", async () => {
    const fetchImpl = githubFetchFor("https://app-git-main-acme.vercel.app");
    const evidence = await verifyTargetFromAuthenticatedGitHubDeployments(
      adminWithProject() as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://app-git-main-acme.vercel.app",
      },
      { fetchImpl: fetchImpl as never }
    );

    expect(evidence).toMatchObject({
      status: "verified",
      evidence: {
        method: "deployment_repository_match",
        provider: "vercel",
        deploymentId: 9001,
        matchedOrigin: "https://app-git-main-acme.vercel.app",
        deploymentEnvironment: "preview",
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer github-token" }),
      })
    );
  });

  it("verifies a custom domain only when authenticated deployment evidence matches exactly", async () => {
    const evidence = await verifyTargetFromAuthenticatedGitHubDeployments(
      adminWithProject() as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://app.example.com",
      },
      { fetchImpl: githubFetchFor("https://app.example.com") as never }
    );

    expect(evidence.status).toBe("verified");
    if (evidence.status !== "verified") throw new Error("Expected verified evidence");
    expect(evidence.evidence.matchedOrigin).toBe("https://app.example.com");
    expect(evidence.evidence.provider).toBe("vercel");
  });

  it("does not accept a hostname merely because it ends in vercel.app", async () => {
    const evidence = await verifyTargetFromAuthenticatedGitHubDeployments(
      adminWithProject() as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://unrelated.vercel.app",
      },
      { fetchImpl: githubFetchFor("https://real-app.vercel.app") as never }
    );

    expect(evidence).toEqual({ status: "not_found" });
  });

  it("blocks cross-project ownership evidence before any provider request", async () => {
    const fetchImpl = githubFetchFor("https://app.example.com");
    const evidence = await verifyTargetFromAuthenticatedGitHubDeployments(
      adminWithProject("33333333-3333-4333-8333-333333333333") as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://app.example.com",
      },
      { fetchImpl: fetchImpl as never }
    );

    expect(evidence).toEqual({ status: "not_found" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not treat anonymous GitHub responses as ownership evidence", async () => {
    vi.mocked(resolveGitHubCredential).mockResolvedValue(null);
    const fetchImpl = githubFetchFor("https://app.example.com");

    const evidence = await verifyTargetFromAuthenticatedGitHubDeployments(
      adminWithProject() as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://app.example.com",
      },
      { fetchImpl: fetchImpl as never }
    );

    expect(evidence).toEqual({ status: "not_found" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("finds an exact Preview deployment outside the first twenty records", async () => {
    const deployments = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      environment: index === 24 ? "Preview" : "Production",
    }));
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/deployments?")) {
        return new Response(JSON.stringify(deployments), { status: 200 });
      }
      if (url.includes("/deployments/25/statuses")) {
        return new Response(
          JSON.stringify([
            {
              state: "success",
              environment_url: "https://preview.example.com",
              target_url: "https://preview.example.com",
              created_at: "2026-08-10T12:00:00.000Z",
              creator: { login: "vercel[bot]", type: "Bot" },
            },
          ]),
          { status: 200 }
        );
      }
      return new Response("[]", { status: 200 });
    });

    const result = await verifyTargetFromAuthenticatedGitHubDeployments(
      adminWithProject() as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://preview.example.com",
      },
      { fetchImpl: fetchImpl as never }
    );

    expect(result).toMatchObject({
      status: "verified",
      evidence: { deploymentId: 25, deploymentEnvironment: "preview" },
    });
  });

  it("paginates until an exact Preview deployment is found", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      environment: "Production",
    }));
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const page = new URL(url).searchParams.get("page");
      if (url.includes("/deployments?") && page === "1") {
        return new Response(JSON.stringify(firstPage), { status: 200 });
      }
      if (url.includes("/deployments?") && page === "2") {
        return new Response(JSON.stringify([{ id: 101, environment: "Preview" }]), {
          status: 200,
        });
      }
      if (url.includes("/deployments/101/statuses")) {
        return new Response(
          JSON.stringify([
            {
              state: "success",
              environment_url: "https://deep-preview.example.com",
              target_url: "https://deep-preview.example.com",
              created_at: "2026-08-10T12:00:00.000Z",
              creator: { login: "vercel[bot]", type: "Bot" },
            },
          ]),
          { status: 200 }
        );
      }
      return new Response("[]", { status: 200 });
    });

    const result = await verifyTargetFromAuthenticatedGitHubDeployments(
      adminWithProject() as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://deep-preview.example.com",
      },
      { fetchImpl: fetchImpl as never }
    );

    expect(result).toMatchObject({
      status: "verified",
      evidence: { deploymentId: 101, deploymentEnvironment: "preview" },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("deployments?per_page=100&page=2"),
      expect.any(Object)
    );
  });

  it("reports an exact Production deployment as blocked instead of Preview", async () => {
    const result = await verifyTargetFromAuthenticatedGitHubDeployments(
      adminWithProject() as never,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        targetOrigin: "https://production.example.com",
      },
      {
        fetchImpl: githubFetchFor(
          "https://production.example.com",
          "vercel[bot]",
          "Production"
        ) as never,
      }
    );

    expect(result).toMatchObject({
      status: "production_blocked",
      evidence: { deploymentEnvironment: "production" },
    });
  });
});

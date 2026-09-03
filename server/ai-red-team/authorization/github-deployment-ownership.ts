import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseGitHubRepository } from "@/lib/github/repository-reference";
import { resolveGitHubCredential } from "@/server/github-app/credential-provider";
import { normalizeOrigin } from "./types";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const GITHUB_PAGE_SIZE = 100;

type GitHubDeployment = {
  id: number;
  environment?: string | null;
  original_environment?: string | null;
};

type GitHubDeploymentStatus = {
  state: string;
  environment_url: string | null;
  target_url: string | null;
  created_at: string;
  creator?: {
    login?: string;
    type?: string;
  } | null;
};

export type AuthenticatedDeploymentOwnershipEvidence = {
  method: "deployment_repository_match";
  provider: "vercel" | "github_deployment";
  deploymentId: number;
  matchedOrigin: string;
  observedAt: string;
  deploymentEnvironment: "preview" | "staging" | "production" | "unknown";
};

export type GitHubDeploymentOwnershipResolution =
  | {
      status: "verified";
      evidence: AuthenticatedDeploymentOwnershipEvidence & {
        deploymentEnvironment: "preview" | "staging";
      };
    }
  | {
      status: "production_blocked";
      evidence: AuthenticatedDeploymentOwnershipEvidence & {
        deploymentEnvironment: "production";
      };
    }
  | { status: "not_found" };

type FetchLike = typeof fetch;

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "SequrAI-Ownership-Verification/1.0",
  };
}

async function requestGitHubJson<T>(
  fetchImpl: FetchLike,
  token: string,
  path: string
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(`${GITHUB_API}${path}`, {
      headers: githubHeaders(token),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function statusOrigin(status: GitHubDeploymentStatus): string | null {
  for (const candidate of [status.environment_url, status.target_url]) {
    if (!candidate) continue;
    try {
      return normalizeOrigin(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

function deploymentProvider(status: GitHubDeploymentStatus) {
  return status.creator?.login?.toLowerCase() === "vercel[bot]"
    ? ("vercel" as const)
    : ("github_deployment" as const);
}

function deploymentEnvironment(
  deployment: GitHubDeployment
): AuthenticatedDeploymentOwnershipEvidence["deploymentEnvironment"] {
  const value = `${deployment.environment ?? ""} ${deployment.original_environment ?? ""}`
    .trim()
    .toLowerCase();
  if (value.includes("production")) return "production";
  if (value.includes("preview")) return "preview";
  if (value.includes("staging")) return "staging";
  return "unknown";
}

/**
 * Uses the existing organization-scoped GitHub connection. A successful
 * deployment status is trusted only when GitHub returns the exact target
 * origin for the repository already linked to this SequrAI project.
 */
export async function verifyTargetFromAuthenticatedGitHubDeployments(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    targetOrigin: string;
  },
  deps: { fetchImpl?: FetchLike } = {}
): Promise<GitHubDeploymentOwnershipResolution> {
  const targetOrigin = normalizeOrigin(input.targetOrigin);
  const { data: project } = await admin
    .from("projects")
    .select("organization_id, github_repo, github_repository_id")
    .eq("id", input.projectId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (
    !project ||
    project.organization_id !== input.organizationId ||
    !project.github_repo ||
    !project.github_repository_id
  ) {
    return { status: "not_found" };
  }

  const credential = await resolveGitHubCredential(admin, input.organizationId, input.projectId);
  // Anonymous GitHub data is not sufficient ownership evidence.
  if (!credential?.token) return { status: "not_found" };

  let ref;
  try {
    ref = parseGitHubRepository(project.github_repo as string);
  } catch {
    return { status: "not_found" };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  let page = 1;
  let productionMatch:
    | (AuthenticatedDeploymentOwnershipEvidence & {
        deploymentEnvironment: "production";
      })
    | null = null;

  while (true) {
    const deployments = await requestGitHubJson<GitHubDeployment[]>(
      fetchImpl,
      credential.token,
      `${base}/deployments?per_page=${GITHUB_PAGE_SIZE}&page=${page}`
    );
    if (!deployments) return { status: "not_found" };

    const prioritized = [...deployments].sort((left, right) => {
      const rank = (deployment: GitHubDeployment) => {
        const environment = deploymentEnvironment(deployment);
        return environment === "preview" || environment === "staging"
          ? 0
          : environment === "production"
            ? 1
            : 2;
      };
      return rank(left) - rank(right);
    });

    for (const deployment of prioritized) {
      let statusPage = 1;
      while (true) {
        const statuses = await requestGitHubJson<GitHubDeploymentStatus[]>(
          fetchImpl,
          credential.token,
          `${base}/deployments/${deployment.id}/statuses?per_page=${GITHUB_PAGE_SIZE}&page=${statusPage}`
        );
        if (!statuses) break;

        for (const status of statuses) {
          if (status.state !== "success" || statusOrigin(status) !== targetOrigin) continue;
          const environment = deploymentEnvironment(deployment);
          const evidence = {
            method: "deployment_repository_match" as const,
            provider: deploymentProvider(status),
            deploymentId: deployment.id,
            matchedOrigin: targetOrigin,
            observedAt: status.created_at,
            deploymentEnvironment: environment,
          };
          if (environment === "preview" || environment === "staging") {
            return {
              status: "verified",
              evidence: {
                ...evidence,
                deploymentEnvironment: environment,
              },
            };
          }
          if (environment === "production" && !productionMatch) {
            productionMatch = {
              ...evidence,
              deploymentEnvironment: "production",
            };
          }
        }

        if (statuses.length < GITHUB_PAGE_SIZE) break;
        statusPage += 1;
      }
    }

    if (deployments.length < GITHUB_PAGE_SIZE) break;
    page += 1;
  }

  return productionMatch
    ? { status: "production_blocked", evidence: productionMatch }
    : { status: "not_found" };
}

import "server-only";

export type CiTriggerSource = "ci";

export function logCiEvent(
  event: string,
  fields: {
    organizationId?: string;
    projectId?: string;
    repositoryId?: string;
    commitSha?: string;
    prNumber?: number | null;
    scanId?: string | null;
    verdictId?: string | null;
    authSource?: "github_app" | "oauth_legacy" | "session" | "api_key" | "oauth" | null;
    triggerSource?: CiTriggerSource;
    outcome?: string;
    stale?: boolean;
  }
) {
  console.info({
    component: "ci-enforcement",
    triggerSource: "ci",
    event,
    ...fields,
  });
}

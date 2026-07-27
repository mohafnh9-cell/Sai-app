import { isFeatureEnabled } from "@/server/feature-flags";
import type { AttackDomain, AttackRequest } from "../types";

/** Director sequence without RT9 — preserved when `business_logic_team` is disabled. */
export const SECURITY_DIRECTOR_CORE_TEAM_ORDER = [
  "browser",
  "authentication",
  "api",
  "authorization",
] as const;

/** Full sequence when Business Logic Team is enabled for the organization. */
export const SECURITY_DIRECTOR_TEAM_ORDER = [
  ...SECURITY_DIRECTOR_CORE_TEAM_ORDER,
  "payments",
] as const;

/** LLM team phase appended when `llm_team` is enabled (after payments when present). */
export const SECURITY_DIRECTOR_LLM_DOMAIN = "llm" as const;

export type SecurityDirectorTeamPhase = (typeof SECURITY_DIRECTOR_TEAM_ORDER)[number];

export function resolveDirectorPipelineDomains(
  request: AttackRequest
): AttackDomain[] {
  const core = [...SECURITY_DIRECTOR_CORE_TEAM_ORDER];
  const businessLogicEnabled = isFeatureEnabled("business_logic_team", {
    organizationId: request.context.organizationId,
  });
  const llmEnabled = isFeatureEnabled("llm_team", {
    organizationId: request.context.organizationId,
  });
  const domains: AttackDomain[] = [...core];
  if (businessLogicEnabled) domains.push("payments");
  if (llmEnabled) domains.push(SECURITY_DIRECTOR_LLM_DOMAIN);
  return domains;
}

export function resolveDirectorPipelineScope(
  request: AttackRequest
): AttackDomain[] | undefined {
  if (request.directorPipeline === false) return request.scope;
  if (request.attackSimulation || request.directorPipeline === true) {
    return resolveDirectorPipelineDomains(request);
  }
  return request.scope;
}

/**
 * AI Red Team Engine (RT1 foundation).
 *
 * Independent from Production Review, Safe Fix, CP, Memory, and MCP.
 * Not wired to product APIs in this phase.
 */
export type * from "./types";
export {
  ATTACK_DOMAINS,
} from "./types";
export * from "./agents";
export * from "./execution";
export * from "./director";
export * from "./intelligence";
export { createRedTeamLogger } from "./logging/red-team-logger";
export type { RedTeamLogger, RedTeamLogEntry, RedTeamLogEvent } from "./logging/red-team-logger";

export * from "./discovery";

export * from "./decision";
export * from "./fix-strategy";
export * from "./engineering";
export * from "./autonomous-orchestrator";
/** Team coordinators and specialists: import from `@/server/ai-red-team/teams/*`, `business-logic`, or `llm-team` to avoid duplicate symbol re-exports. */
export * from "./authorization";

export { InMemoryRedTeamRunStore } from "./runs/red-team-run-store";
export type { RedTeamRunRecord, RedTeamRunStore } from "./runs/red-team-run-store";
export type { RedTeamRunStatus as PersistedRedTeamRunStatus } from "./runs/red-team-run-store";
export * from "./runs/request-red-team-run";

import { createAgentRegistry, registerRedTeamAgents } from "./agents";
import { createSecurityDirector } from "./director";
import {
  createBrowserTeam,
  createBrowserSpecialistRegistry,
  createDefaultBrowserSpecialists,
} from "./teams/browser";
import { createAuthenticationTeam } from "./teams/authentication/authentication-team";
import {
  createApiTeamCoordinator,
  createApiSpecialistRegistry,
  createDefaultApiSpecialists,
} from "./teams/api";
import {
  createAuthorizationTeamCoordinator,
  createAuthorizationSpecialistRegistry,
  createDefaultAuthorizationSpecialists,
} from "./teams/authorization";
import {
  createBusinessLogicTeamCoordinator,
  createBusinessLogicSpecialistRegistry,
  createDefaultBusinessLogicSpecialists,
} from "./business-logic";
import { createLlmTeamCoordinator } from "./llm-team";

/** Factory for local/integration use — does not register routes or MCP tools. */
export function createDefaultRedTeamEngine() {
  const registry = createAgentRegistry();
  registerRedTeamAgents(registry, {
    authenticationTeam: createAuthenticationTeam(),
    apiTeam: createApiTeamCoordinator({
      registry: createApiSpecialistRegistry(createDefaultApiSpecialists()),
    }),
    authorizationTeam: createAuthorizationTeamCoordinator({
      registry: createAuthorizationSpecialistRegistry(createDefaultAuthorizationSpecialists()),
    }),
    businessLogicTeam: createBusinessLogicTeamCoordinator({
      registry: createBusinessLogicSpecialistRegistry(createDefaultBusinessLogicSpecialists()),
    }),
    llmTeam: createLlmTeamCoordinator(),
  });
  const director = createSecurityDirector({ registry });
  return { registry, director };
}

/** Browser Team enabled (mock Playwright runtime unless playwright is installed). */
export function createBrowserEnabledRedTeamEngine() {
  const registry = createAgentRegistry();
  const specialistRegistry = createBrowserSpecialistRegistry(createDefaultBrowserSpecialists());
  const browserTeam = createBrowserTeam({ registry: specialistRegistry });
  registerRedTeamAgents(registry, {
    browserTeam,
    authenticationTeam: createAuthenticationTeam(),
    apiTeam: createApiTeamCoordinator({
      registry: createApiSpecialistRegistry(createDefaultApiSpecialists()),
    }),
    authorizationTeam: createAuthorizationTeamCoordinator({
      registry: createAuthorizationSpecialistRegistry(createDefaultAuthorizationSpecialists()),
    }),
    businessLogicTeam: createBusinessLogicTeamCoordinator({
      registry: createBusinessLogicSpecialistRegistry(createDefaultBusinessLogicSpecialists()),
    }),
    llmTeam: createLlmTeamCoordinator(),
  });
  const director = createSecurityDirector({ registry });
  return { registry, director, browserTeam, specialistRegistry };
}

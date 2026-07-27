export type { RedTeamAgent, AgentExecutionInput } from "./base-agent";
export { BaseAgent } from "./base-agent";
export { AgentRegistry, createAgentRegistry } from "./registry";
export {
  AuthenticationAgent,
  AuthorizationAgent,
  BrowserAgent,
  ApiAgent,
  createDefaultPlaceholderAgents,
  registerDefaultPlaceholderAgents,
} from "./placeholder-agents";
export { AuthenticationTeamAgent } from "./authentication-team-agent";

import type { AgentRegistry } from "./registry";
import { createDefaultPlaceholderAgents } from "./placeholder-agents";
import { BrowserTeamAgent } from "./browser-team-agent";
import { AuthenticationTeamAgent } from "./authentication-team-agent";
import type { BrowserTeam } from "../teams/browser/browser-team";
import type { AuthenticationTeam } from "../teams/authentication/authentication-team";
import type { ApiTeamCoordinator } from "../teams/api/api-team-coordinator";
import { ApiTeamAgent } from "../teams/api/api-team-agent";
import type { AuthorizationTeamCoordinator } from "../teams/authorization/authorization-team-coordinator";
import { AuthorizationTeamAgent } from "../teams/authorization/authorization-team-agent";
import type { BusinessLogicTeamCoordinator } from "../business-logic/coordinator";
import { BusinessLogicTeamAgent } from "../business-logic/business-logic-team-agent";
import type { LlmTeamCoordinator } from "../llm-team/coordinator";
import { LlmTeamAgent } from "../llm-team/llm-team-agent";

/** Registers RT1 placeholders, replacing browser/auth/api placeholders when teams are provided. */
export function registerRedTeamAgents(
  registry: AgentRegistry,
  options?: {
    browserTeam?: BrowserTeam;
    authenticationTeam?: AuthenticationTeam;
    apiTeam?: ApiTeamCoordinator;
    authorizationTeam?: AuthorizationTeamCoordinator;
    businessLogicTeam?: BusinessLogicTeamCoordinator;
    llmTeam?: LlmTeamCoordinator;
  }
): void {
  const agents = createDefaultPlaceholderAgents();
  const placeholders = agents.filter(
    (agent) =>
      agent.id !== "surface.browser" &&
      agent.id !== "auth.authentication" &&
      agent.id !== "surface.api" &&
      agent.id !== "auth.authorization"
  );
  registry.registerMany(placeholders);

  if (options?.browserTeam) {
    registry.register(new BrowserTeamAgent(options.browserTeam));
  } else {
    const browser = agents.find((agent) => agent.id === "surface.browser");
    if (browser) registry.register(browser);
  }

  if (options?.authenticationTeam) {
    registry.register(new AuthenticationTeamAgent(options.authenticationTeam));
  } else {
    const auth = agents.find((agent) => agent.id === "auth.authentication");
    if (auth) registry.register(auth);
  }

  if (options?.apiTeam) {
    registry.register(new ApiTeamAgent(options.apiTeam));
  } else {
    const api = agents.find((agent) => agent.id === "surface.api");
    if (api) registry.register(api);
  }

  if (options?.authorizationTeam) {
    registry.register(new AuthorizationTeamAgent(options.authorizationTeam));
  } else {
    const authz = agents.find((agent) => agent.id === "auth.authorization");
    if (authz) registry.register(authz);
  }

  if (options?.businessLogicTeam) {
    registry.register(new BusinessLogicTeamAgent(options.businessLogicTeam));
  }

  if (options?.llmTeam) {
    registry.register(new LlmTeamAgent(options.llmTeam));
  }
}

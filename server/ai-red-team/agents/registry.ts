import type { ApplicationContext } from "../types";
import type { RedTeamAgent } from "./base-agent";

export class AgentRegistry {
  private readonly agents = new Map<string, RedTeamAgent>();

  register(agent: RedTeamAgent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent already registered: ${agent.id}`);
    }
    this.agents.set(agent.id, agent);
  }

  registerMany(agents: RedTeamAgent[]): void {
    for (const agent of agents) {
      this.register(agent);
    }
  }

  getById(agentId: string): RedTeamAgent | null {
    return this.agents.get(agentId) ?? null;
  }

  listRegistered(): RedTeamAgent[] {
    return [...this.agents.values()].sort((a, b) => a.priority - b.priority);
  }

  async listAvailable(context: ApplicationContext): Promise<RedTeamAgent[]> {
    const registered = this.listRegistered();
    const available: RedTeamAgent[] = [];
    for (const agent of registered) {
      if (await agent.canRun(context)) {
        available.push(agent);
      }
    }
    return available;
  }

  async listAvailableForDomain(
    context: ApplicationContext,
    domain: RedTeamAgent["domain"]
  ): Promise<RedTeamAgent[]> {
    const available = await this.listAvailable(context);
    return available.filter((agent) => agent.domain === domain);
  }
}

export function createAgentRegistry(agents: RedTeamAgent[] = []): AgentRegistry {
  const registry = new AgentRegistry();
  if (agents.length > 0) registry.registerMany(agents);
  return registry;
}

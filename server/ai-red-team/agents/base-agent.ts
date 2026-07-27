import type { ApplicationContext, AttackDomain } from "../types";
import type { AttackResult } from "../types";

export type AgentExecutionInput = {
  requestId: string;
  context: ApplicationContext;
  domain: AttackDomain;
  signal?: AbortSignal;
};

export type RedTeamAgent = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Lower number runs earlier when priorities tie-break. */
  readonly priority: number;
  readonly domain: AttackDomain;
  readonly requiredCapabilities: readonly string[];
  canRun(context: ApplicationContext): boolean | Promise<boolean>;
  execute(input: AgentExecutionInput): Promise<AttackResult>;
};

export abstract class BaseAgent implements RedTeamAgent {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly priority: number;
  abstract readonly domain: AttackDomain;
  abstract readonly requiredCapabilities: readonly string[];

  async canRun(context: ApplicationContext): Promise<boolean> {
    const caps = context.declaredCapabilities ?? [];
    if (this.requiredCapabilities.length === 0) return true;
    return this.requiredCapabilities.every((required) => caps.includes(required));
  }

  abstract execute(input: AgentExecutionInput): Promise<AttackResult>;
}

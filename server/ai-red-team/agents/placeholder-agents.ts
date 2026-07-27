import { randomUUID } from "node:crypto";
import { BaseAgent, type AgentExecutionInput } from "./base-agent";
import type { AttackDomain, AttackResult } from "../types";

function placeholderResult(
  agent: { id: string; name: string; domain: AttackDomain },
  input: AgentExecutionInput,
  startedAt: number
): AttackResult {
  const finishedAt = Date.now();
  return {
    agentId: agent.id,
    agentName: agent.name,
    domain: agent.domain,
    status: "completed",
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    findings: [],
    evidence: [
      {
        id: randomUUID(),
        kind: "placeholder",
        label: "RT1 placeholder — no attack logic executed",
        detail: `Agent ${agent.id} registered and invoked for domain ${agent.domain}.`,
        capturedAt: new Date(finishedAt).toISOString(),
      },
    ],
    logs: [`[${agent.id}] placeholder execute completed`],
    metadata: { phase: "RT1", requestId: input.requestId },
  };
}

export class AuthenticationAgent extends BaseAgent {
  readonly id = "auth.authentication";
  readonly name = "Authentication Agent";
  readonly description = "Future authentication-focused red team agent.";
  readonly priority = 10;
  readonly domain = "authentication" as const;
  readonly requiredCapabilities = ["authentication"] as const;

  async execute(input: AgentExecutionInput): Promise<AttackResult> {
    const startedAt = Date.now();
    return placeholderResult(this, input, startedAt);
  }
}

export class AuthorizationAgent extends BaseAgent {
  readonly id = "auth.authorization";
  readonly name = "Authorization Agent";
  readonly description = "Future authorization and access-control red team agent.";
  readonly priority = 20;
  readonly domain = "authorization" as const;
  readonly requiredCapabilities = ["authorization"] as const;

  async execute(input: AgentExecutionInput): Promise<AttackResult> {
    const startedAt = Date.now();
    return placeholderResult(this, input, startedAt);
  }
}

export class BrowserAgent extends BaseAgent {
  readonly id = "surface.browser";
  readonly name = "Browser Agent";
  readonly description = "Future browser and client-side red team agent.";
  readonly priority = 30;
  readonly domain = "browser" as const;
  readonly requiredCapabilities = ["browser"] as const;

  async execute(input: AgentExecutionInput): Promise<AttackResult> {
    const startedAt = Date.now();
    return placeholderResult(this, input, startedAt);
  }
}

export class ApiAgent extends BaseAgent {
  readonly id = "surface.api";
  readonly name = "API Agent";
  readonly description = "Future API and integration red team agent.";
  readonly priority = 40;
  readonly domain = "api" as const;
  readonly requiredCapabilities = ["api"] as const;

  async execute(input: AgentExecutionInput): Promise<AttackResult> {
    const startedAt = Date.now();
    return placeholderResult(this, input, startedAt);
  }
}

export function createDefaultPlaceholderAgents(): BaseAgent[] {
  return [
    new AuthenticationAgent(),
    new AuthorizationAgent(),
    new BrowserAgent(),
    new ApiAgent(),
  ];
}

export function registerDefaultPlaceholderAgents(registry: {
  registerMany: (agents: BaseAgent[]) => void;
}): void {
  registry.registerMany(createDefaultPlaceholderAgents());
}

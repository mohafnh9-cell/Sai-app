import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createAgentRegistry,
  registerDefaultPlaceholderAgents,
  BaseAgent,
  type AgentExecutionInput,
} from "../agents";
import { createAttackPlanner } from "../execution/attack-planner";
import { createAttackOrchestrator } from "../execution/attack-orchestrator";
import { createSecurityDirector } from "../director/security-director";
import { createDefaultRedTeamEngine } from "../index";
import type { ApplicationContext, AttackResult } from "../types";
import type { DiscoveryRepositoryInput } from "../discovery/types";

const sampleDiscoveryRepository = (): DiscoveryRepositoryInput => ({
  projectId: "project-1",
  organizationId: "org-1",
  commitSha: "941162c47e01efea4e7723e0aaeb4c64582ebb48",
  files: [
    {
      path: "package.json",
      content: JSON.stringify({
        dependencies: {
          next: "16.0.0",
          react: "19.0.0",
          "@supabase/supabase-js": "2.0.0",
          stripe: "14.0.0",
          openai: "4.0.0",
        },
      }),
    },
    { path: "prisma/schema.prisma", content: 'datasource db { provider = "postgresql" }' },
    { path: "vercel.json", content: "{}" },
  ],
});

const baseContext: ApplicationContext = {
  projectId: "project-1",
  organizationId: "org-1",
  declaredCapabilities: ["authentication", "authorization", "browser", "api"],
};

describe("AttackPlanner", () => {
  it("creates a generic multi-domain plan", () => {
    const planner = createAttackPlanner();
    const plan = planner.createPlan({ context: baseContext });
    expect(plan.phases.length).toBeGreaterThanOrEqual(4);
    expect(plan.phases.map((p) => p.domain)).toContain("authentication");
    expect(plan.phases.map((p) => p.domain)).toContain("llm");
  });

  it("respects scope when provided", () => {
    const planner = createAttackPlanner();
    const plan = planner.createPlan({
      context: baseContext,
      scope: ["api", "browser"],
    });
    expect(plan.phases).toHaveLength(2);
    expect(plan.phases.every((p) => p.domain === "api" || p.domain === "browser")).toBe(true);
  });
});

describe("AgentRegistry", () => {
  it("registers placeholder agents", () => {
    const registry = createAgentRegistry();
    registerDefaultPlaceholderAgents(registry);
    expect(registry.listRegistered()).toHaveLength(4);
  });

  it("rejects duplicate agent ids", () => {
    const registry = createAgentRegistry();
    registerDefaultPlaceholderAgents(registry);
    expect(() => registerDefaultPlaceholderAgents(registry)).toThrow(/already registered/);
  });

  it("lists available agents based on capabilities", async () => {
    const registry = createAgentRegistry();
    registerDefaultPlaceholderAgents(registry);
    const available = await registry.listAvailable({
      ...baseContext,
      declaredCapabilities: ["api"],
    });
    expect(available).toHaveLength(1);
    expect(available[0]?.id).toBe("surface.api");
  });
});

describe("AttackResult serialization", () => {
  it("round-trips through JSON", async () => {
    const registry = createAgentRegistry();
    registerDefaultPlaceholderAgents(registry);
    const director = createSecurityDirector({ registry });
    const report = await director.run({
      requestId: randomUUID(),
      context: baseContext,
      scope: ["authentication"],
      discoveryRepository: sampleDiscoveryRepository(),
    });
    const serialized = JSON.stringify(report.results[0]);
    const parsed = JSON.parse(serialized) as AttackResult;
    expect(parsed.agentId).toBe("auth.authentication");
    expect(parsed.status).toBe("completed");
  });
});

describe("SecurityDirector", () => {
  it("runs placeholder agents and returns a unified report", async () => {
    const logs: string[] = [];
    const registry = createAgentRegistry();
    registerDefaultPlaceholderAgents(registry);
    const director = createSecurityDirector({
      registry,
      logger: {
        log(entry) {
          logs.push(entry.event);
        },
      },
    });

    const report = await director.run({
      requestId: "req-1",
      context: baseContext,
      scope: ["authentication", "api"],
      options: { maxParallel: 2 },
      discoveryRepository: sampleDiscoveryRepository(),
    });

    expect(report.discovery.detectedTechnologies.length).toBeGreaterThan(0);

    expect(report.results).toHaveLength(2);
    expect(report.summary.completed).toBe(2);
    expect(logs).toContain("director_started");
    expect(logs).toContain("planning_completed");
    expect(logs).toContain("agents_selected");
    expect(logs).toContain("director_completed");
    expect(report.intelligence).toBeDefined();
    expect(report.securityDecision).toBeDefined();
    expect(report.productionVerdict).toBeDefined();
    expect(logs).toContain("intelligence_completed");
    expect(logs).toContain("decision_completed");
    expect(logs).toContain("production_verdict_completed");
  });
});

describe("AttackOrchestrator parallel execution", () => {
  it("runs independent agents concurrently within a phase", async () => {
    class SlowAgent extends BaseAgent {
      readonly id = "test.slow-a";
      readonly name = "Slow A";
      readonly description = "test";
      readonly priority = 1;
      readonly domain = "api" as const;
      readonly requiredCapabilities = ["api"] as const;

      async execute(input: AgentExecutionInput): Promise<AttackResult> {
        await new Promise((r) => setTimeout(r, 40));
        const startedAt = Date.now();
        return {
          agentId: this.id,
          agentName: this.name,
          domain: this.domain,
          status: "completed",
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 40,
          findings: [],
          evidence: [],
          logs: [input.requestId],
        };
      }
    }

    class SlowAgentB extends SlowAgent {
      readonly id = "test.slow-b";
      readonly name = "Slow B";
    }

    const registry = createAgentRegistry([new SlowAgent(), new SlowAgentB()]);
    const orchestrator = createAttackOrchestrator();
    const planner = createAttackPlanner();
    const plan = planner.createPlan({ context: baseContext, scope: ["api"] });

    const started = Date.now();
    const output = await orchestrator.execute({
      requestId: "parallel-1",
      context: baseContext,
      plan,
      registry,
      options: { maxParallel: 2 },
    });
    const elapsed = Date.now() - started;

    expect(output.results).toHaveLength(2);
    expect(elapsed).toBeLessThan(120);
  });
});

describe("AttackRunner lifecycle", () => {
  it("supports cancellation via AbortSignal", async () => {
    class HangingAgent extends BaseAgent {
      readonly id = "test.hang";
      readonly name = "Hang";
      readonly description = "test";
      readonly priority = 1;
      readonly domain = "api" as const;
      readonly requiredCapabilities = ["api"] as const;

      async execute(input: AgentExecutionInput): Promise<AttackResult> {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5_000);
          input.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true }
          );
        });
        throw new Error("unreachable");
      }
    }

    const registry = createAgentRegistry([new HangingAgent()]);
    const orchestrator = createAttackOrchestrator();
    const planner = createAttackPlanner();
    const plan = planner.createPlan({ context: baseContext, scope: ["api"] });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    const output = await orchestrator.execute({
      requestId: "cancel-1",
      context: baseContext,
      plan,
      registry,
      options: { signal: controller.signal, timeoutMs: 10_000 },
    });

    expect(output.results[0]?.status).toBe("cancelled");
  });

  it("retries failed agents when configured", async () => {
    let attempts = 0;
    class FlakyAgent extends BaseAgent {
      readonly id = "test.flaky";
      readonly name = "Flaky";
      readonly description = "test";
      readonly priority = 1;
      readonly domain = "api" as const;
      readonly requiredCapabilities = ["api"] as const;

      async execute(): Promise<AttackResult> {
        attempts += 1;
        if (attempts < 2) throw new Error("transient");
        const startedAt = Date.now();
        return {
          agentId: this.id,
          agentName: this.name,
          domain: this.domain,
          status: "completed",
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 1,
          findings: [],
          evidence: [],
          logs: [],
        };
      }
    }

    const registry = createAgentRegistry([new FlakyAgent()]);
    const orchestrator = createAttackOrchestrator();
    const plan = createAttackPlanner().createPlan({ context: baseContext, scope: ["api"] });
    const output = await orchestrator.execute({
      requestId: "retry-1",
      context: baseContext,
      plan,
      registry,
      options: { maxRetries: 2 },
    });

    expect(attempts).toBe(2);
    expect(output.results[0]?.status).toBe("completed");
  });
});

describe("createDefaultRedTeamEngine", () => {
  it("wires registry and director", () => {
    const engine = createDefaultRedTeamEngine();
    expect(engine.registry.listRegistered().length).toBeGreaterThanOrEqual(4);
    expect(engine.director).toBeDefined();
  });
});

describe("placeholder agent execute", () => {
  it("returns completed placeholder AttackResult", async () => {
    const registry = createAgentRegistry();
    registerDefaultPlaceholderAgents(registry);
    const director = createSecurityDirector({ registry });
    const report = await director.run({
      requestId: randomUUID(),
      context: baseContext,
      scope: ["authorization"],
      discoveryRepository: sampleDiscoveryRepository(),
    });
    expect(report.results[0]?.evidence[0]?.kind).toBe("placeholder");
    expect(vi.isMockFunction(console.info)).toBe(false);
  });
});

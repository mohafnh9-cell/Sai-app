import type { AttackPlan } from "./attack-plan";
import type { AttackExecution, AttackResult, AttackSummary } from "./attack-models";
import type { DiscoveryReport } from "../discovery/types";
import type { SecurityIntelligenceReport } from "../intelligence/models";

export type RedTeamReport = {
  requestId: string;
  discovery: DiscoveryReport;
  plan: AttackPlan;
  summary: AttackSummary;
  results: AttackResult[];
  executions: AttackExecution[];
  generatedAt: string;
  /** Present when attack simulation was accepted asynchronously (RT3). */
  asyncRun?: {
    runId: string;
    status: "queued" | "running";
  };
  /** RT4 — correlated intelligence across attack teams (not exposed via MCP directly). */
  intelligence?: SecurityIntelligenceReport;
  /** RT5 — authoritative security decision and deployment verdict. */
  securityDecision?: import("../decision/decision-model").SecurityDecisionReport;
  /** RT5 — product-facing Production Verdict from the Decision Engine. */
  productionVerdict?: import("../verdict/red-team-production-verdict").RedTeamProductionVerdict;
  /** RT12 — grouped remediation strategy, prompts, and replay-linked verification plan. */
  fixStrategy?: import("../fix-strategy/fix-strategy.types").FixStrategyReport;
  /** RT12 UEE — canonical AI-independent engineering plan and adapter outputs. */
  universalEngineering?: import("../engineering/uee.types").UniversalEngineeringEngineResult;
  /** RT13 — autonomous team selection, graph, and strategies. */
  orchestrator?: import("../autonomous-orchestrator/aso.types").OrchestratorDecision;
};

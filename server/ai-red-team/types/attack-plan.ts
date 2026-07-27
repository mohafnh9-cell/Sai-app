import type { AttackDomain } from "./application-context";

export type AttackPlanPhase = {
  id: string;
  domain: AttackDomain;
  label: string;
  /** Agent ids selected for this phase (filled by orchestrator from registry). */
  agentIds: string[];
  dependsOn?: string[];
};

export type AttackPlan = {
  planId: string;
  createdAt: string;
  phases: AttackPlanPhase[];
  notes?: string[];
};

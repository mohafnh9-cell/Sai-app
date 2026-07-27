import { randomUUID } from "node:crypto";
import type { DecisionHistoryEntry, SecurityDecisionType, SecurityDeploymentVerdictStatus } from "./decision-model";
import type { ConfidenceBand } from "../intelligence/models";
import { DECISION_POLICY_VERSION } from "./decision-model";

export function recordDecisionHistory(input: {
  projectId: string;
  commitSha: string | null;
  decision: SecurityDecisionType;
  deploymentVerdict: SecurityDeploymentVerdictStatus;
  confidence: ConfidenceBand;
  previousDecision?: SecurityDecisionType | null;
  previousDeploymentVerdict?: SecurityDeploymentVerdictStatus | null;
  reasonSummary: string;
}): DecisionHistoryEntry {
  return {
    id: randomUUID(),
    projectId: input.projectId,
    commitSha: input.commitSha,
    previousDecision: input.previousDecision ?? null,
    decision: input.decision,
    previousDeploymentVerdict: input.previousDeploymentVerdict ?? null,
    deploymentVerdict: input.deploymentVerdict,
    confidence: input.confidence,
    policyVersion: DECISION_POLICY_VERSION,
    reasonSummary: input.reasonSummary,
    recordedAt: new Date().toISOString(),
  };
}

export class InMemoryDecisionHistoryStore {
  private readonly entries: DecisionHistoryEntry[] = [];

  append(entry: DecisionHistoryEntry): void {
    this.entries.push(entry);
  }

  listByProject(projectId: string): DecisionHistoryEntry[] {
    return this.entries.filter((e) => e.projectId === projectId);
  }

  latest(projectId: string): DecisionHistoryEntry | null {
    const list = this.listByProject(projectId);
    return list[list.length - 1] ?? null;
  }
}

export const globalDecisionHistoryStore = new InMemoryDecisionHistoryStore();

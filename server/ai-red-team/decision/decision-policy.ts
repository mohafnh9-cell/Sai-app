import type { DecisionContext } from "./decision-context";
import type { SecurityIntelligenceReport } from "../intelligence/models";
import type { SecurityDecisionType } from "./decision-model";

export type DecisionPolicyResult = {
  policyId: string;
  triggered: boolean;
  effect: SecurityDecisionType | null;
  block: boolean;
  requireVerification: boolean;
  insufficientEvidence: boolean;
  rationale: string;
  evidenceUsed: string[];
  evidenceMissing: string[];
};

export interface DecisionPolicy {
  readonly id: string;
  readonly description: string;
  evaluate(input: {
    intelligence: SecurityIntelligenceReport;
    context: DecisionContext;
  }): DecisionPolicyResult;
}

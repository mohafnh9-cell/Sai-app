import type { CoreUniqueId } from "../contracts/identifiers";
import type { CoreFindingSeverity } from "../severity/severity.types";
import type { CoreFindingConfidence } from "../confidence/confidence.types";
import type { CoreEvidence } from "../evidence/evidence.types";

export type CoreAttackCategory = string;

export type CoreAttackExecutionClassification =
  | "confirmed"
  | "highly_likely"
  | "likely"
  | "possible"
  | "unsupported"
  | "inconclusive"
  | "blocked";

export type CoreAttackCase<TCategory extends CoreAttackCategory = CoreAttackCategory> = {
  id: CoreUniqueId;
  attackKey: string;
  title: string;
  description: string;
  category: TCategory;
  severity: CoreFindingSeverity;
  confidence: CoreFindingConfidence;
  evidence: CoreEvidence<string>[];
  metadata?: Record<string, unknown>;
};

export type CoreAttackCollection<TCategory extends CoreAttackCategory = CoreAttackCategory> = {
  id: CoreUniqueId;
  cases: CoreAttackCase<TCategory>[];
  validationIssues: Array<{ code: string; message: string; caseId?: CoreUniqueId }>;
  generatedAt: string;
};

export type CoreAttackGeneratorContract<TInput, TCategory extends CoreAttackCategory> = {
  generate(input: TInput): CoreAttackCollection<TCategory>;
};

export type CoreAttackValidatorContract<TCategory extends CoreAttackCategory> = {
  validate(collection: CoreAttackCollection<TCategory>): CoreAttackCollection<TCategory>;
};

export type CoreAttackPlannerContract<TContext, TPlan> = {
  plan(context: TContext): TPlan;
};

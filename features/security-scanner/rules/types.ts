import type { FindingDraft, NormalizedFile, StackProfile } from "../types";
import type { ScanSharedContext } from "@/features/security-analysis/shared/scan-context";

export interface RuleContext {
  files: readonly NormalizedFile[];
  stack: StackProfile;
  getFile(path: string): NormalizedFile | undefined;
  shared?: ScanSharedContext;
}

export interface ScanRule {
  id: string;
  title: string;
  run(context: RuleContext): FindingDraft[] | Promise<FindingDraft[]>;
}

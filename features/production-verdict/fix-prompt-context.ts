import type { VerdictStatus } from "@/brain/production-verdict/schema";
import {
  defaultStackFromFramework,
  stackFromDetectedStack,
  type FixPromptStack,
} from "@/brain/fix-prompt";
import type { ScanFinding } from "@/features/security-scanner/components/types";

export type FixPromptContext = {
  projectName?: string;
  stack?: FixPromptStack;
  findings?: ScanFinding[];
  currentVerdictStatus?: VerdictStatus;
  currentScore?: number | null;
};

export function fixPromptContextFromScan(options: {
  projectName?: string;
  detectedStack?: unknown;
  framework?: string | null;
  findings?: ScanFinding[];
  currentVerdictStatus?: VerdictStatus;
  currentScore?: number | null;
}): FixPromptContext {
  let stack = stackFromDetectedStack(options.detectedStack);
  if (
    stack.languages.length === 0 &&
    stack.frameworks.length === 0 &&
    stack.services.length === 0
  ) {
    stack = defaultStackFromFramework(options.framework);
  }

  return {
    projectName: options.projectName,
    stack,
    ...(options.findings ? { findings: options.findings } : {}),
    ...(options.currentVerdictStatus ? { currentVerdictStatus: options.currentVerdictStatus } : {}),
    ...(options.currentScore != null ? { currentScore: options.currentScore } : {}),
  };
}

import { isScannablePromptFile, shouldSkipPath } from "./context";
import { dedupePromptFindings, scanPromptInjectionFile } from "./scan-file";
import type { PromptScanResult } from "./types";

export type RepositoryFile = {
  path: string;
  content: string;
};

export function scanPromptInjectionRepository(files: RepositoryFile[]): PromptScanResult {
  const findings = [];
  let filesScanned = 0;
  let filesConsidered = 0;

  for (const file of files) {
    if (shouldSkipPath(file.path)) continue;
    if (!isScannablePromptFile(file.path)) continue;
    filesConsidered += 1;

    const fileFindings = scanPromptInjectionFile(file.path, file.content);
    if (fileFindings.length > 0) {
      filesScanned += 1;
      findings.push(...fileFindings);
    }
  }

  return {
    findings: dedupePromptFindings(findings),
    filesScanned,
    filesConsidered,
  };
}

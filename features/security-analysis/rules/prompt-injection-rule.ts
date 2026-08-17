import type { FindingDraft } from "@/features/security-scanner/types";
import type { ScanRule } from "@/features/security-scanner/rules/types";
import { PROMPT_INJECTION_RULE_ID } from "../prompt-injection/constants";
import { scanPromptInjectionRepository } from "../prompt-injection/scan-repository";
import {
  dedupePromptSecurityFindings,
  promptRawFindingsToSecurityAnalysis,
} from "../prompt-injection/to-findings";
import type { RepositoryFile } from "../sbom/types";
import { securityAnalysisFindingsToDrafts } from "../to-finding-draft";

export function analyzePromptInjectionSecurity(files: RepositoryFile[]) {
  const scan = scanPromptInjectionRepository(files);
  const findings = dedupePromptSecurityFindings(
    promptRawFindingsToSecurityAnalysis(scan.findings)
  );
  return { scan, findings };
}

export const promptInjectionRule: ScanRule = {
  id: PROMPT_INJECTION_RULE_ID,
  title: "Prompt injection security analysis",
  run: ({ files }) => {
    const repositoryFiles: RepositoryFile[] = files.map((file) => ({
      path: file.path,
      content: file.content,
    }));
    const { findings } = analyzePromptInjectionSecurity(repositoryFiles);
    if (findings.length === 0) {
      return [];
    }
    return securityAnalysisFindingsToDrafts(findings);
  },
};

export function repositoryFilesToPromptInjectionDrafts(
  files: RepositoryFile[]
): FindingDraft[] {
  const { findings } = analyzePromptInjectionSecurity(files);
  return securityAnalysisFindingsToDrafts(findings);
}

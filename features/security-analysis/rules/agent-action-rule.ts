import type { FindingDraft } from "@/features/security-scanner/types";
import type { ScanRule } from "@/features/security-scanner/rules/types";
import { AGENT_ACTION_RULE_ID } from "../agent-action/constants";
import { scanAgentActionRepository } from "../agent-action/scan-repository";
import {
  agentActionRawFindingsToSecurityAnalysis,
  dedupeAgentSecurityFindings,
} from "../agent-action/to-findings";
import type { RepositoryFile } from "../sbom/types";
import { securityAnalysisFindingsToDrafts } from "../to-finding-draft";

export function analyzeAgentActionSecurity(files: RepositoryFile[]) {
  const scan = scanAgentActionRepository(files);
  const findings = dedupeAgentSecurityFindings(
    agentActionRawFindingsToSecurityAnalysis(scan.findings)
  );
  return { scan, findings };
}

export const agentActionRule: ScanRule = {
  id: AGENT_ACTION_RULE_ID,
  title: "Agent action security analysis",
  run: ({ files }) => {
    const repositoryFiles: RepositoryFile[] = files.map((file) => ({
      path: file.path,
      content: file.content,
    }));
    const { findings } = analyzeAgentActionSecurity(repositoryFiles);
    if (findings.length === 0) {
      return [];
    }
    return securityAnalysisFindingsToDrafts(findings);
  },
};

export function repositoryFilesToAgentActionDrafts(files: RepositoryFile[]): FindingDraft[] {
  const { findings } = analyzeAgentActionSecurity(files);
  return securityAnalysisFindingsToDrafts(findings);
}

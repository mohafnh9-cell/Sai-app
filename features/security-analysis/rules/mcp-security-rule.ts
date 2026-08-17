import type { FindingDraft } from "@/features/security-scanner/types";
import type { ScanRule } from "@/features/security-scanner/rules/types";
import { MCP_SECURITY_RULE_ID } from "../mcp/constants";
import { scanMcpRepository } from "../mcp/scan-repository";
import {
  dedupeMcpSecurityFindings,
  mcpRawFindingsToSecurityAnalysis,
} from "../mcp/to-findings";
import type { RepositoryFile } from "../sbom/types";
import { securityAnalysisFindingsToDrafts } from "../to-finding-draft";

export function analyzeMcpSecurity(files: RepositoryFile[]) {
  const scan = scanMcpRepository(files);
  const findings = dedupeMcpSecurityFindings(mcpRawFindingsToSecurityAnalysis(scan.findings));
  return { scan, findings };
}

export const mcpSecurityRule: ScanRule = {
  id: MCP_SECURITY_RULE_ID,
  title: "MCP server security analysis",
  run: ({ files }) => {
    const repositoryFiles: RepositoryFile[] = files.map((file) => ({
      path: file.path,
      content: file.content,
    }));
    const { findings } = analyzeMcpSecurity(repositoryFiles);
    if (findings.length === 0) {
      return [];
    }
    return securityAnalysisFindingsToDrafts(findings);
  },
};

export function repositoryFilesToMcpDrafts(files: RepositoryFile[]): FindingDraft[] {
  const { findings } = analyzeMcpSecurity(files);
  return securityAnalysisFindingsToDrafts(findings);
}

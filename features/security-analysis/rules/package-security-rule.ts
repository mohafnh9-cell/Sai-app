import type { FindingDraft } from "@/features/security-scanner/types";
import type { ScanRule } from "@/features/security-scanner/rules/types";
import { PACKAGE_SECURITY_RULE_ID } from "../package-security/constants";
import { analyzePackageSecurity } from "../package-security/analyze";
import {
  dedupePackageSecurityAnalysisFindings,
  packageSecurityRawFindingsToSecurityAnalysis,
} from "../package-security/to-findings";
import type { RepositoryFile } from "../sbom/types";
import { toRepositoryFiles } from "../shared/scan-context";
import { securityAnalysisFindingsToDrafts } from "../to-finding-draft";

export async function analyzePackageSecurityEvidence(
  files: RepositoryFile[],
  options?: Parameters<typeof analyzePackageSecurity>[1]
) {
  const scan = await analyzePackageSecurity(files, options);
  const findings = dedupePackageSecurityAnalysisFindings(
    packageSecurityRawFindingsToSecurityAnalysis(scan.findings)
  );
  return { scan, findings };
}

export const packageSecurityRule: ScanRule = {
  id: PACKAGE_SECURITY_RULE_ID,
  title: "Package hallucination and dependency confusion analysis",
  run: async ({ files, shared }) => {
    const repositoryFiles = shared?.repositoryFiles ?? toRepositoryFiles(files);
    const { findings } = await analyzePackageSecurityEvidence(repositoryFiles, {
      sbomComponents: shared?.sbomSnapshot.components,
      cache: shared?.registryCache,
    });
    if (findings.length === 0) {
      return [];
    }
    return securityAnalysisFindingsToDrafts(findings);
  },
};

export async function repositoryFilesToPackageSecurityDrafts(
  files: RepositoryFile[]
): Promise<FindingDraft[]> {
  const { findings } = await analyzePackageSecurityEvidence(files);
  return securityAnalysisFindingsToDrafts(findings);
}

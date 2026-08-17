import type { FindingDraft } from "@/features/security-scanner/types";
import type { ScanRule } from "@/features/security-scanner/rules/types";
import { analyzeOsvSbomEvidence, OSV_SBOM_RULE_ID } from "../osv/enrich-sbom";
import { toRepositoryFiles } from "../shared/scan-context";
import { securityAnalysisFindingsToDrafts } from "../to-finding-draft";

export const osvSbomRule: ScanRule = {
  id: OSV_SBOM_RULE_ID,
  title: "OSV dependency vulnerability evidence",
  run: async ({ files, shared }) => {
    const repositoryFiles = shared?.repositoryFiles ?? toRepositoryFiles(files);

    const { findings } = await analyzeOsvSbomEvidence(repositoryFiles, {
      includeDev: true,
      sbomSnapshot: shared?.sbomSnapshot,
      osv: shared?.osvCache ? { cache: shared.osvCache } : undefined,
    });

    if (findings.length === 0) {
      return [];
    }

    return securityAnalysisFindingsToDrafts(findings);
  },
};

export function repositoryFilesToOsvDrafts(
  files: import("../sbom/types").RepositoryFile[],
  options?: Parameters<typeof analyzeOsvSbomEvidence>[1]
): Promise<FindingDraft[]> {
  return analyzeOsvSbomEvidence(files, options).then(({ findings }) =>
    securityAnalysisFindingsToDrafts(findings)
  );
}

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

    const { findings, osvError } = await analyzeOsvSbomEvidence(repositoryFiles, {
      includeDev: true,
      sbomSnapshot: shared?.sbomSnapshot,
      osv: shared?.osvCache ? { cache: shared.osvCache } : undefined,
    });

    // L1.5: analyzeOsvSbomEvidence swallows its own network/timeout/rate-
    // limit failures internally and returns findings: [] with the real
    // error stashed in osvError -- previously discarded here, meaning a
    // network outage (or an offline local run) during dependency-
    // vulnerability checking was indistinguishable from "no vulnerable
    // dependencies," in both the local and cloud paths (this file is
    // shared, unchanged code). Re-throwing routes it through
    // scanRepository()'s own existing per-rule failure tracking
    // (ruleFailures / omissions with reason "rule-error") -- reusing that
    // mechanism rather than inventing a second one.
    if (osvError) {
      throw new Error(`OSV dependency check failed: ${osvError}`);
    }

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

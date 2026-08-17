import { discoverMcpTargets, findBaselineForManifest, type RepositoryFile } from "./discover";
import { dedupeMcpFindings, scanMcpFileContent } from "./scan-file";
import { checkMcpRugPull, scanMcpManifest } from "./scan-manifest";
import type { McpRawFinding, McpScanResult } from "./types";

export function scanMcpRepository(files: RepositoryFile[]): McpScanResult {
  const targets = discoverMcpTargets(files);
  const findings: McpRawFinding[] = [];

  for (const file of targets.sourceFiles) {
    findings.push(...scanMcpFileContent(file.path, file.content));
  }

  for (const manifest of targets.manifestFiles) {
    findings.push(...scanMcpManifest(manifest.path, manifest.content));
    const baseline = findBaselineForManifest(manifest.path, targets.baselineFiles);
    if (baseline) {
      findings.push(
        ...checkMcpRugPull(manifest.path, manifest.content, baseline.content)
      );
    }
  }

  const deduped = dedupeMcpFindings(findings);
  const severityOrder = { ERROR: 0, WARNING: 1, INFO: 2 } as const;
  deduped.sort(
    (left, right) =>
      (severityOrder[left.severity] ?? 2) - (severityOrder[right.severity] ?? 2)
  );

  return {
    targets,
    findings: deduped,
    filesScanned: targets.sourceFiles.length + targets.manifestFiles.length,
  };
}

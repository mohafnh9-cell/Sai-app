import { buildSbomSnapshot } from "../sbom/lockfile-parsers";
import type { RepositoryFile, SbomSnapshot } from "../sbom/types";
import { createOsvMemoryCache } from "../osv/client";
import { createRegistryCache } from "../package-security/registry-client";
import type { RegistryLookupResult, RegistryPhaseMetrics } from "../package-security/types";
import type { OsvApiVulnerability } from "../osv/types";

/**
 * Phase 23 -- a mutable box packageSecurityRule writes its aggregate
 * registryMetrics into after running, so scanner.ts (which owns `shared`
 * but doesn't call packageSecurityRule directly -- the rule registry does)
 * can pick it up afterward and attach it to the scan's persisted metrics.
 * Deliberately not a return value: ScanRule.run's contract is
 * Promise<FindingDraft[]>, and changing that for one rule would ripple
 * through every rule implementation for no benefit -- this side-channel is
 * the smallest change that gets aggregate-only telemetry out to the one
 * place (scans.metrics, already persisted on every scan) that needs it.
 */
export type RegistryMetricsSink = { current: RegistryPhaseMetrics | null };

export type ScanSharedContext = {
  repositoryFiles: RepositoryFile[];
  sbomSnapshot: SbomSnapshot;
  registryCache: Map<string, RegistryLookupResult>;
  osvCache: Map<string, OsvApiVulnerability[]>;
  registryMetricsSink: RegistryMetricsSink;
};

export function toRepositoryFiles(
  files: ReadonlyArray<{ path: string; content: string }>
): RepositoryFile[] {
  return files.map((file) => ({ path: file.path, content: file.content }));
}

export function createScanSharedContext(
  files: ReadonlyArray<{ path: string; content: string }>,
  options: { includeDev?: boolean } = {}
): ScanSharedContext {
  const repositoryFiles = toRepositoryFiles(files);
  return {
    repositoryFiles,
    sbomSnapshot: buildSbomSnapshot(repositoryFiles, { includeDev: options.includeDev ?? true }),
    registryCache: createRegistryCache(),
    osvCache: createOsvMemoryCache(),
    registryMetricsSink: { current: null },
  };
}

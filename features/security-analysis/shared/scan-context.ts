import { buildSbomSnapshot } from "../sbom/lockfile-parsers";
import type { RepositoryFile, SbomSnapshot } from "../sbom/types";
import { createOsvMemoryCache } from "../osv/client";
import { createRegistryCache } from "../package-security/registry-client";
import type { RegistryLookupResult } from "../package-security/types";
import type { OsvApiVulnerability } from "../osv/types";

export type ScanSharedContext = {
  repositoryFiles: RepositoryFile[];
  sbomSnapshot: SbomSnapshot;
  registryCache: Map<string, RegistryLookupResult>;
  osvCache: Map<string, OsvApiVulnerability[]>;
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
  };
}

import type { SbomEcosystem } from "../sbom/types";

export type PackageDependencySource =
  | "manifest"
  | "lockfile"
  | "requirements"
  | "pyproject"
  | "cargo"
  | "go-mod"
  | "gemfile";

export type PackageDependencyKind =
  | "registry"
  | "workspace"
  | "local-path"
  | "git"
  | "file"
  | "link"
  | "unknown";

export type DeclaredPackageDependency = {
  name: string;
  version: string;
  ecosystem: SbomEcosystem;
  file: string;
  line: number;
  source: PackageDependencySource;
  kind: PackageDependencyKind;
  isDev?: boolean;
  scope?: string;
};

export type RegistryLookupStatus =
  | "exists"
  | "not_found"
  | "unavailable"
  | "skipped";

export type RegistryLookupResult = {
  status: RegistryLookupStatus;
  reason?: string;
  registryUrl?: string;
};

export type PackageSecurityTier =
  | "verified-exists"
  | "potential-hallucination"
  | "typosquat-candidate"
  | "dependency-confusion"
  | "ecosystem-mismatch";

export type PackageSecurityRawFinding = {
  rule: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  action: "BLOCK" | "WARN" | "ALLOW";
  message: string;
  category: string;
  file: string;
  line: number;
  packageName: string;
  ecosystem: SbomEcosystem;
  requestedVersion: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  tier: PackageSecurityTier;
  similarPackages?: Array<{ name: string; distance: number }>;
  registryEvidence?: string;
  match?: string;
};

/**
 * Phase 22 -- aggregate, scan-level dependency-intelligence metrics.
 * Deliberately aggregate-only (no per-dependency log lines) so this stays
 * cheap at 1,000-scan scale; carries only counts/durations, nothing
 * sensitive (no package names, no URLs, no response content).
 *
 * registryPhaseDurationMs is real wall-clock time (measured start-to-finish
 * around the whole lookupPackages call), NOT the sum of individual lookup
 * durations -- those overlap under concurrency, so summing them would wildly
 * overstate elapsed time. Both are reported so the difference is visible.
 */
export type RegistryPhaseMetrics = {
  dependencyCount: number;
  uniqueDependencyCount: number;
  registryLookupCount: number;
  cacheHitCount: number;
  coalescedCount: number;
  networkRequestCount: number;
  p50LookupMs: number;
  p95LookupMs: number;
  p99LookupMs: number;
  maxLookupMs: number;
  /** True wall-clock elapsed time for the whole registry-verification phase. */
  registryPhaseDurationMs: number;
  /** Sum of individual lookup durations -- NOT wall-clock; will exceed registryPhaseDurationMs whenever lookups overlap. */
  sumOfLookupDurationsMs: number;
  semaphoreWaitTotalMs: number;
  unavailableCount: number;
  timeoutCount: number;
  retryCount: number;
};

export type PackageSecurityScanResult = {
  findings: PackageSecurityRawFinding[];
  dependenciesChecked: number;
  registryLookups: number;
  skippedInternal: number;
  registryUnavailable: boolean;
  registryMetrics: RegistryPhaseMetrics;
};

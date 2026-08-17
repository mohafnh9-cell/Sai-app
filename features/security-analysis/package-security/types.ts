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

export type PackageSecurityScanResult = {
  findings: PackageSecurityRawFinding[];
  dependenciesChecked: number;
  registryLookups: number;
  skippedInternal: number;
  registryUnavailable: boolean;
};

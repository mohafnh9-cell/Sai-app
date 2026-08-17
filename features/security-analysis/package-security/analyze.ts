import type { RepositoryFile, SbomComponent } from "../sbom/types";
import { REGISTRY_SUPPORTED_ECOSYSTEMS } from "./constants";
import { checkDependencyConfusion } from "./dependency-confusion";
import {
  dedupeDeclaredDependencies,
  detectEcosystemMismatch,
  detectPrimaryEcosystems,
  extractDeclaredDependencies,
  isInternalDependency,
  isLikelyPrivatePackage,
} from "./extract-dependencies";
import { createRegistryCache, lookupPackages, registryCacheKey } from "./registry-client";
import { findSimilarPackages } from "./typosquat";
import type {
  DeclaredPackageDependency,
  PackageSecurityRawFinding,
  PackageSecurityScanResult,
  RegistryLookupResult,
} from "./types";
import type { RegistryClientOptions } from "./registry-client";

export type AnalyzePackageSecurityOptions = RegistryClientOptions & {
  skipRegistry?: boolean;
  sbomComponents?: SbomComponent[];
};

function pushFinding(
  findings: PackageSecurityRawFinding[],
  finding: PackageSecurityRawFinding
): void {
  findings.push(finding);
}

function buildNotFoundFinding(
  dep: DeclaredPackageDependency,
  lookup: RegistryLookupResult
): PackageSecurityRawFinding {
  const similar = findSimilarPackages(dep.name, dep.ecosystem);
  const hasStrongTyposquat = similar.some((entry) => entry.distance === 1);
  return {
    rule: hasStrongTyposquat ? "package.typosquat.not-found" : "package.hallucination.not-found",
    severity: hasStrongTyposquat ? "HIGH" : "HIGH",
    action: hasStrongTyposquat ? "BLOCK" : "WARN",
    message: hasStrongTyposquat
      ? `Dependency '${dep.name}' was not found in the ${dep.ecosystem} registry and closely resembles '${similar[0]?.name}'. This may be a hallucinated or typosquatted package name.`
      : `Dependency '${dep.name}' was not found in the ${dep.ecosystem} registry. Verify this package exists before installing it.`,
    category: hasStrongTyposquat ? "package-typosquat" : "package-hallucination",
    file: dep.file,
    line: dep.line,
    packageName: dep.name,
    ecosystem: dep.ecosystem,
    requestedVersion: dep.version,
    confidence: "HIGH",
    tier: hasStrongTyposquat ? "typosquat-candidate" : "potential-hallucination",
    similarPackages: similar,
    registryEvidence: lookup.registryUrl,
    match: dep.name,
  };
}

function buildTyposquatFinding(
  dep: DeclaredPackageDependency,
  similar: Array<{ name: string; distance: number }>
): PackageSecurityRawFinding | null {
  if (similar.length === 0) return null;
  const closest = similar[0]!;
  return {
    rule: "package.typosquat.similar-name",
    severity: closest.distance === 1 ? "HIGH" : "MEDIUM",
    action: closest.distance === 1 ? "BLOCK" : "WARN",
    message: `Dependency '${dep.name}' closely resembles known package '${closest.name}' (edit distance ${closest.distance}). Confirm the intended package to avoid typosquatting.`,
    category: "package-typosquat",
    file: dep.file,
    line: dep.line,
    packageName: dep.name,
    ecosystem: dep.ecosystem,
    requestedVersion: dep.version,
    confidence: closest.distance === 1 ? "HIGH" : "MEDIUM",
    tier: "typosquat-candidate",
    similarPackages: similar,
    match: dep.name,
  };
}

function buildConfusionFinding(
  dep: DeclaredPackageDependency,
  signal: NonNullable<ReturnType<typeof checkDependencyConfusion>>
): PackageSecurityRawFinding {
  return {
    rule: signal.rule,
    severity: signal.confidence === "HIGH" ? "HIGH" : "MEDIUM",
    action: "WARN",
    message: signal.message,
    category: "dependency-confusion",
    file: dep.file,
    line: dep.line,
    packageName: dep.name,
    ecosystem: dep.ecosystem,
    requestedVersion: dep.version,
    confidence: signal.confidence,
    tier: "dependency-confusion",
    match: dep.name,
  };
}

function buildMismatchFinding(dep: DeclaredPackageDependency): PackageSecurityRawFinding {
  return {
    rule: "package.ecosystem.mismatch",
    severity: "MEDIUM",
    action: "WARN",
    message: `Dependency '${dep.name}' is declared for ${dep.ecosystem} but the repository appears to primarily use a different ecosystem. This may be an AI-generated dependency mismatch.`,
    category: "ecosystem-mismatch",
    file: dep.file,
    line: dep.line,
    packageName: dep.name,
    ecosystem: dep.ecosystem,
    requestedVersion: dep.version,
    confidence: "MEDIUM",
    tier: "ecosystem-mismatch",
    match: dep.name,
  };
}

export function dedupePackageSecurityFindings(
  findings: PackageSecurityRawFinding[]
): PackageSecurityRawFinding[] {
  const seen = new Set<string>();
  const deduped: PackageSecurityRawFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.rule}|${finding.ecosystem}|${finding.packageName.toLowerCase()}|${finding.file}|${finding.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

export async function analyzePackageSecurity(
  files: RepositoryFile[],
  options: AnalyzePackageSecurityOptions = {}
): Promise<PackageSecurityScanResult> {
  const findings: PackageSecurityRawFinding[] = [];
  const dependencies = dedupeDeclaredDependencies(
    extractDeclaredDependencies(files, { sbomComponents: options.sbomComponents })
  );
  const primaryEcosystems = detectPrimaryEcosystems(files);
  const registryTargets = dependencies.filter(
    (dep) =>
      REGISTRY_SUPPORTED_ECOSYSTEMS.has(dep.ecosystem) &&
      !isInternalDependency(dep)
  );

  let registryLookups = 0;
  let skippedInternal = dependencies.length - registryTargets.length;
  let registryUnavailable = false;

  const lookupResults =
    options.skipRegistry || registryTargets.length === 0
      ? new Map<string, RegistryLookupResult>()
      : await lookupPackages(
          registryTargets.map((dep) => ({ ecosystem: dep.ecosystem, name: dep.name })),
          {
            fetchImpl: options.fetchImpl,
            timeoutMs: options.timeoutMs,
            cache: options.cache ?? createRegistryCache(),
          }
        );
  registryLookups = lookupResults.size;

  for (const dep of dependencies) {
    const confusion = checkDependencyConfusion(dep.name, dep.ecosystem);
    if (confusion) {
      pushFinding(findings, buildConfusionFinding(dep, confusion));
    }

    if (detectEcosystemMismatch(dep, primaryEcosystems)) {
      pushFinding(findings, buildMismatchFinding(dep));
    }

    if (isInternalDependency(dep) || !REGISTRY_SUPPORTED_ECOSYSTEMS.has(dep.ecosystem)) {
      continue;
    }

    const lookup = lookupResults.get(registryCacheKey(dep.ecosystem, dep.name));
    if (!lookup) continue;

    if (lookup.status === "unavailable") {
      registryUnavailable = true;
      continue;
    }
    if (lookup.status === "skipped") continue;

    if (lookup.status === "not_found") {
      if (isLikelyPrivatePackage(dep)) {
        continue;
      }
      pushFinding(findings, buildNotFoundFinding(dep, lookup));
      continue;
    }

    const similar = findSimilarPackages(dep.name, dep.ecosystem, 1, 3);
    const safeSimilar = similar.filter((entry) => entry.distance === 1);
    const typosquatFinding = buildTyposquatFinding(dep, safeSimilar);
    if (typosquatFinding && dep.name !== safeSimilar[0]?.name) {
      pushFinding(findings, typosquatFinding);
    }
  }

  return {
    findings: dedupePackageSecurityFindings(findings),
    dependenciesChecked: dependencies.length,
    registryLookups,
    skippedInternal,
    registryUnavailable,
  };
}

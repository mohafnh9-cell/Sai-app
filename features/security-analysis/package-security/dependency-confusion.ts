import type { SbomEcosystem } from "../sbom/types";
import { findSimilarPackages } from "./typosquat";

const INTERNAL_PREFIXES = [
  "internal-",
  "private-",
  "priv-",
  "corp-",
  "company-",
  "org-",
  "dev-",
  "local-",
] as const;

const SCOPED_PACKAGE_RE = /^@([a-z0-9-]+)\//;

export type DependencyConfusionSignal = {
  risk: boolean;
  rule: string;
  message: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export function checkDependencyConfusion(
  packageName: string,
  ecosystem: SbomEcosystem
): DependencyConfusionSignal | null {
  const scopedMatch = packageName.match(SCOPED_PACKAGE_RE);
  if (scopedMatch) {
    const scope = scopedMatch[1];
    const unscopedName = packageName.replace(SCOPED_PACKAGE_RE, "");
    const similar = findSimilarPackages(unscopedName, ecosystem, 1, 1);
    if (similar.length > 0) {
      return {
        risk: true,
        rule: "package.dependency-confusion.scoped-public-collision",
        message: `Scoped package '${packageName}' contains unscoped name '${unscopedName}' similar to known public package '${similar[0]?.name}'. Verify scope authenticity to avoid dependency confusion.`,
        confidence: "HIGH",
      };
    }
    return {
      risk: true,
      rule: "package.dependency-confusion.scoped-internal",
      message: `Scoped package '${packageName}' follows an internal naming pattern (@${scope}/...). Ensure the scope is authentic and not a dependency confusion target.`,
      confidence: "MEDIUM",
    };
  }

  const lowerName = packageName.toLowerCase();
  for (const prefix of INTERNAL_PREFIXES) {
    if (lowerName.startsWith(prefix)) {
      const baseName = lowerName.slice(prefix.length);
      if (baseName.length > 0) {
        return {
          risk: true,
          rule: "package.dependency-confusion.internal-prefix",
          message: `Package '${packageName}' uses the '${prefix}' prefix which suggests an internal/private package. Confirm it resolves to the intended private source.`,
          confidence: "MEDIUM",
        };
      }
    }
  }

  return null;
}

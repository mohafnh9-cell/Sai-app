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

// Scopes are a single word (@company, @acme-corp), not "prefix-baseName" like
// unscoped internal packages, so match against the bare word rather than the
// dash-suffixed unscoped prefixes above.
const INTERNAL_SCOPE_WORDS = INTERNAL_PREFIXES.map((prefix) => prefix.replace(/-$/, ""));

function looksLikeInternalScope(scope: string): boolean {
  return INTERNAL_SCOPE_WORDS.some((word) => scope === word || scope.startsWith(`${word}-`));
}

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
    // Nearly every real-world lockfile has dozens of scoped packages
    // (@babel/*, @types/*, @radix-ui/*, ...) and none of them are dependency
    // confusion risks -- the risk is specific to scopes that read as an
    // org's own internal/private convention, not "any scope that exists".
    if (looksLikeInternalScope(scope)) {
      return {
        risk: true,
        rule: "package.dependency-confusion.scoped-internal",
        message: `Scoped package '${packageName}' follows an internal naming pattern (@${scope}/...). Ensure the scope is authentic and not a dependency confusion target.`,
        confidence: "MEDIUM",
      };
    }
    return null;
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

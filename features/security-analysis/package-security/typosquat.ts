import type { SbomEcosystem } from "../sbom/types";

const TOP_PACKAGES: Partial<Record<SbomEcosystem, string[]>> = {
  npm: [
    "express",
    "react",
    "lodash",
    "axios",
    "chalk",
    "commander",
    "debug",
    "moment",
    "uuid",
    "semver",
    "webpack",
    "typescript",
    "eslint",
    "jest",
    "prettier",
    "next",
    "dotenv",
    "mongoose",
    "socket.io",
    "jsonwebtoken",
    "bcrypt",
    "nodemon",
  ],
  pypi: [
    "requests",
    "flask",
    "django",
    "numpy",
    "pandas",
    "boto3",
    "setuptools",
    "pip",
    "pyyaml",
    "cryptography",
    "pytest",
    "fastapi",
    "pydantic",
    "httpx",
    "black",
    "tensorflow",
    "scikit-learn",
  ],
  rubygems: [
    "rails",
    "rake",
    "bundler",
    "rspec",
    "sinatra",
    "puma",
    "devise",
    "sidekiq",
    "redis",
    "nokogiri",
    "rubocop",
    "stripe",
  ],
  crates: [
    "serde",
    "tokio",
    "clap",
    "rand",
    "log",
    "reqwest",
    "regex",
    "chrono",
    "uuid",
    "anyhow",
    "serde_json",
    "actix-web",
    "axum",
  ],
};

/** Exact (not fuzzy) membership check -- used where similarity alone would be too weak a signal. */
export function isKnownPopularPackage(name: string, ecosystem: SbomEcosystem): boolean {
  const knownPackages = TOP_PACKAGES[ecosystem];
  if (!knownPackages) return false;
  const normalized = name.toLowerCase().replace(/^@/, "");
  return knownPackages.some((known) => known.toLowerCase() === normalized);
}

export function levenshteinDistance(a: string, b: string): number {
  if (a.length > b.length) {
    [a, b] = [b, a];
  }
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;

  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      if (a[i - 1] === b[j - 1]) {
        curr[i] = prev[i - 1];
      } else {
        curr[i] = 1 + Math.min(prev[i], curr[i - 1], prev[i - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m] ?? 0;
}

export function findSimilarPackages(
  packageName: string,
  ecosystem: SbomEcosystem,
  maxDistance = 2,
  limit = 5
): Array<{ name: string; distance: number }> {
  const knownPackages = TOP_PACKAGES[ecosystem];
  if (!knownPackages) return [];

  // Phase 31.1: npm scopes are their own namespace -- "@radix-ui/rect" can
  // never actually be confused with (or resolve in place of) the unscoped
  // "react" package at install time, so fuzzy-comparing only the unscoped
  // tail ("rect" vs "react", edit distance 1) produced false positives
  // against real, legitimately-scoped packages. A scoped package's identity
  // includes its scope; comparing it against TOP_PACKAGES' unscoped names is
  // a structurally different question (see checkDependencyConfusion for the
  // narrower, exact-match check that *is* meaningful for scoped packages).
  if (packageName.includes("/")) return [];

  const unscopedInput = packageName.toLowerCase().replace(/^@/, "");

  const matches: Array<{ name: string; distance: number }> = [];
  for (const known of knownPackages) {
    const normalizedKnown = known.toLowerCase();
    if (unscopedInput === normalizedKnown) continue;
    if (Math.abs(unscopedInput.length - normalizedKnown.length) > maxDistance) continue;
    const distance = levenshteinDistance(unscopedInput, normalizedKnown);
    if (distance >= 1 && distance <= maxDistance) {
      matches.push({ name: known, distance });
    }
  }

  return matches
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, limit);
}

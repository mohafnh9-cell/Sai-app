import { describe, expect, it } from "vitest";
import { findSimilarPackages, isKnownPopularPackage, levenshteinDistance } from "../package-security/typosquat";

describe("Phase 31.1 -- typosquat scoped-package identity fix", () => {
  it("does not fuzzy-compare a scoped package's tail against unscoped known packages (@radix-ui/rect vs react)", () => {
    expect(findSimilarPackages("@radix-ui/rect", "npm")).toEqual([]);
  });

  it("still detects a genuinely suspicious UNSCOPED near-miss of a popular package", () => {
    const expressMatches = findSimilarPackages("expres", "npm");
    expect(expressMatches.some((m) => m.name === "express")).toBe(true);
  });

  it("legitimate scoped similarity: a scope containing 'react' in its own name is not itself flagged as a typosquat target", () => {
    // @foo/react is a *real* pattern many orgs use for their own React
    // wrapper packages -- it must not be fuzzy-compared against the
    // unscoped "react" package via the tail-stripping bug.
    expect(findSimilarPackages("@foo/react", "npm")).toEqual([]);
  });

  it("unscoped packages are unaffected -- fuzzy matching still works for the real threat model", () => {
    const matches = findSimilarPackages("lod4sh", "npm");
    expect(matches.some((m) => m.name === "lodash")).toBe(true);
  });
});

describe("Phase 31.1 -- isKnownPopularPackage (exact match for scoped-collision check)", () => {
  it("matches an exact known name", () => {
    expect(isKnownPopularPackage("react", "npm")).toBe(true);
    expect(isKnownPopularPackage("express", "npm")).toBe(true);
  });

  it("does not match a near-miss", () => {
    expect(isKnownPopularPackage("rect", "npm")).toBe(false);
    expect(isKnownPopularPackage("expres", "npm")).toBe(false);
  });
});

describe("levenshteinDistance (unchanged utility)", () => {
  it("computes edit distance correctly", () => {
    expect(levenshteinDistance("rect", "react")).toBe(1);
    expect(levenshteinDistance("express", "express")).toBe(0);
  });
});

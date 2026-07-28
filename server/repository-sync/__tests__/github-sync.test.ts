import { describe, expect, it } from "vitest";
import { commitsMatch } from "@/lib/repository-sync/commits-match";

describe("commitsMatch", () => {
  it("matches full SHAs", () => {
    expect(commitsMatch("abc123def456", "abc123def456")).toBe(true);
  });

  it("matches short and full prefixes", () => {
    expect(commitsMatch("abc123def456789", "abc123d")).toBe(true);
    expect(commitsMatch("abc123d", "abc123def456789")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(commitsMatch("ABC123", "abc123")).toBe(true);
  });

  it("returns false when either value is missing", () => {
    expect(commitsMatch(null, "abc")).toBe(false);
    expect(commitsMatch("abc", undefined)).toBe(false);
  });
});

describe("getGitHubSyncSnapshot outOfSync logic", () => {
  it("detects mismatch via commitsMatch semantics", () => {
    const head = "5ff918caaabb";
    const analyzed = "5ff918c111111";
    expect(commitsMatch(head, analyzed)).toBe(false);
  });
});

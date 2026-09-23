import { describe, expect, it } from "vitest";
import {
  assertRepositoryIdentityUnchanged,
  RepositoryIdentityChangedError,
  repositoryIdentityMatches,
} from "../repository-identity";

// Pass 3 CRIT-004: repository identity is GitHub's numeric id and is
// immutable once a project is bound to it.
describe("repositoryIdentityMatches", () => {
  it("matches the same numeric id (including bigint returned as a string)", () => {
    expect(repositoryIdentityMatches(4242, 4242)).toBe(true);
    expect(repositoryIdentityMatches("4242", 4242)).toBe(true);
  });

  it("rejects a different repository that merely reuses the name", () => {
    expect(repositoryIdentityMatches(4242, 9999)).toBe(false);
  });

  it("treats an unbound legacy project as compatible so the first fetch can bind it", () => {
    expect(repositoryIdentityMatches(null, 4242)).toBe(true);
    expect(repositoryIdentityMatches(undefined, 4242)).toBe(true);
  });

  it("does not treat an unreadable bound id as a match", () => {
    expect(repositoryIdentityMatches("not-a-number", 4242)).toBe(false);
  });
});

describe("assertRepositoryIdentityUnchanged", () => {
  it("does not throw for the same or an unbound repository", () => {
    expect(() => assertRepositoryIdentityUnchanged(4242, 4242)).not.toThrow();
    expect(() => assertRepositoryIdentityUnchanged(null, 4242)).not.toThrow();
  });

  it("throws a typed error when the name now points to a different repository", () => {
    expect(() => assertRepositoryIdentityUnchanged(4242, 9999)).toThrow(RepositoryIdentityChangedError);
    try {
      assertRepositoryIdentityUnchanged(4242, 9999);
    } catch (error) {
      expect((error as RepositoryIdentityChangedError).code).toBe("REPOSITORY_IDENTITY_CHANGED");
    }
  });
});

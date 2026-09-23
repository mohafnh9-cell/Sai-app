import { describe, expect, it } from "vitest";
import {
  filterOwnAppInstallations,
  filterSelfAuthorizedInstallations,
  type GitHubAuthenticatedUser,
  type GitHubUserInstallation,
} from "@/server/github-app/user-installations";

function installation(overrides: Partial<GitHubUserInstallation> = {}): GitHubUserInstallation {
  return {
    id: 1,
    app_id: 999,
    account: { id: 10, login: "someone", type: "User" },
    repository_selection: "all",
    suspended_at: null,
    ...overrides,
  };
}

describe("filterOwnAppInstallations", () => {
  it("keeps only installations matching the configured app id", () => {
    const result = filterOwnAppInstallations(
      [installation({ id: 1, app_id: 999 }), installation({ id: 2, app_id: 1234 })],
      "999"
    );

    expect(result.map((entry) => entry.id)).toEqual([1]);
  });

  it("excludes suspended installations even when the app id matches", () => {
    const result = filterOwnAppInstallations(
      [installation({ id: 1, app_id: 999, suspended_at: "2026-01-01T00:00:00Z" })],
      "999"
    );

    expect(result).toHaveLength(0);
  });

  it("returns an empty array when nothing matches", () => {
    const result = filterOwnAppInstallations([installation({ app_id: 111 })], "999");

    expect(result).toEqual([]);
  });
});

describe("filterSelfAuthorizedInstallations", () => {
  const self: GitHubAuthenticatedUser = { id: 42, login: "mohafnh9-cell" };

  // SECURITY: this is the check that prevents a mere read/write
  // collaborator on an organization-wide installation from attaching it
  // to an unrelated SequrAI organization -- GET /user/installations alone
  // would have included it.
  it("excludes organization-type installations even when they appear in the user's verified list", () => {
    const result = filterSelfAuthorizedInstallations(
      [installation({ id: 1, account: { id: 999, login: "some-org", type: "Organization" } })],
      self
    );

    expect(result).toEqual([]);
  });

  it("keeps a personal (User-type) installation whose account id matches the caller's own verified id", () => {
    const result = filterSelfAuthorizedInstallations(
      [installation({ id: 1, account: { id: 42, login: "mohafnh9-cell", type: "User" } })],
      self
    );

    expect(result.map((entry) => entry.id)).toEqual([1]);
  });

  it("excludes a User-type installation belonging to a different account id, even with the same login string", () => {
    // Never trust login alone -- a different account.id under a
    // coincidentally-matching login must still be rejected.
    const result = filterSelfAuthorizedInstallations(
      [installation({ id: 1, account: { id: 12345, login: "mohafnh9-cell", type: "User" } })],
      self
    );

    expect(result).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  gitHubRepositoryReferenceFromApi,
  isMalformedDoubleOwnerGitHubUrl,
  normalizeRepositoryPathParts,
  normalizeStoredGitHubRepository,
  parseGitHubRepository,
  repositorySelectorMatchesStored,
  toGitHubHtmlUrl,
} from "../repository-reference";

describe("repository-reference", () => {
  it("parses owner/repo and html_url", () => {
    expect(parseGitHubRepository("acme/alpha")).toEqual({ owner: "acme", repo: "alpha" });
    expect(parseGitHubRepository("https://github.com/acme/alpha")).toEqual({
      owner: "acme",
      repo: "alpha",
    });
    expect(toGitHubHtmlUrl({ owner: "acme", repo: "alpha" })).toBe(
      "https://github.com/acme/alpha"
    );
  });

  it("repairs double-owner path segments", () => {
    expect(
      parseGitHubRepository("https://github.com/mohafnh9-cell/mohafnh9-cell/sequrai-app")
    ).toEqual({ owner: "mohafnh9-cell", repo: "sequrai-app" });
    expect(normalizeRepositoryPathParts(["mohafnh9-cell", "mohafnh9-cell", "sequrai-app"])).toEqual({
      owner: "mohafnh9-cell",
      repo: "sequrai-app",
    });
    expect(
      normalizeStoredGitHubRepository("https://github.com/mohafnh9-cell/mohafnh9-cell/sequrai-app")
    ).toBe("https://github.com/mohafnh9-cell/sequrai-app");
  });

  it("uses GitHub html_url from API without prepending owner to full_name", () => {
    const ref = gitHubRepositoryReferenceFromApi({
      full_name: "acme/alpha",
      html_url: "https://github.com/acme/alpha",
    });
    expect(ref.htmlUrl).toBe("https://github.com/acme/alpha");
    expect(ref.fullName).toBe("acme/alpha");
  });

  it("matches repository selectors across storage formats", () => {
    const stored = "https://github.com/acme/alpha";
    expect(repositorySelectorMatchesStored("acme/alpha", stored)).toBe(true);
    expect(repositorySelectorMatchesStored("https://github.com/acme/alpha", stored)).toBe(true);
    expect(repositorySelectorMatchesStored("https://github.com/other/beta", stored)).toBe(false);
  });

  it("detects malformed double-owner URLs", () => {
    expect(
      isMalformedDoubleOwnerGitHubUrl("https://github.com/mohafnh9-cell/mohafnh9-cell/sequrai-app")
    ).toBe(true);
    expect(isMalformedDoubleOwnerGitHubUrl("https://github.com/mohafnh9-cell/sequrai-app")).toBe(
      false
    );
  });
});

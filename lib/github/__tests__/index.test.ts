import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubApiError, getGitHubRepos, getGitHubTokenScopes } from "../index";

/**
 * Phase 31.2: getGitHubRepos/getGitHubTokenScopes used to throw an untyped
 * generic Error on any non-ok GitHub response, collapsing 401/403/429/5xx
 * into one indistinguishable failure for the caller (app/api/github/repos
 * always returned a single generic 500). These prove the real status code
 * now survives as a typed GitHubApiError.
 */

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("getGitHubRepos", () => {
  it("throws GitHubApiError carrying the real status on a 401", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 401 })) as never;
    await expect(getGitHubRepos("token")).rejects.toBeInstanceOf(GitHubApiError);
    try {
      await getGitHubRepos("token");
      expect.unreachable();
    } catch (error) {
      expect((error as GitHubApiError).status).toBe(401);
    }
  });

  it("throws GitHubApiError carrying 429 on rate limit", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 429 })) as never;
    try {
      await getGitHubRepos("token");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).status).toBe(429);
    }
  });

  it("returns repos across pages on success", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      const body = call === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: i })) : [{ id: 999 }];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as never;
    const repos = await getGitHubRepos("token");
    expect(repos).toHaveLength(101);
  });
});

describe("getGitHubTokenScopes", () => {
  it("throws GitHubApiError with the real status on failure", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 500 })) as never;
    try {
      await getGitHubTokenScopes("token");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).status).toBe(500);
    }
  });
});

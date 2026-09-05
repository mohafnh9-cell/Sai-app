import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 31.2: listInstallationRepositories used to `break` its pagination
 * loop on any non-2xx GitHub response and return whatever it had
 * accumulated so far -- a failure on the FIRST page silently produced an
 * empty array, indistinguishable from "this installation genuinely has
 * zero repositories." These tests prove it now throws a typed error
 * instead, and that a real empty (200 OK, zero repos) response is still
 * returned as [] correctly.
 */

vi.mock("../installation-token-service", () => ({
  fetchInstallationAccessToken: vi.fn(async () => ({ token: "fake-token", expiresAt: new Date().toISOString() })),
}));

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.resetModules();
});

describe("listInstallationRepositories", () => {
  it("throws GitHubInstallationApiError on a 401 response instead of returning []", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 401 })) as never;
    const { listInstallationRepositories, GitHubInstallationApiError } = await import("../github-api");
    await expect(listInstallationRepositories(123)).rejects.toBeInstanceOf(GitHubInstallationApiError);
  });

  it("throws with the real upstream status code (429)", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 429 })) as never;
    const { listInstallationRepositories, GitHubInstallationApiError } = await import("../github-api");
    try {
      await listInstallationRepositories(123);
      expect.unreachable("expected listInstallationRepositories to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubInstallationApiError);
      expect((error as InstanceType<typeof GitHubInstallationApiError>).status).toBe(429);
    }
  });

  it("returns a real empty array (not an error) when the API genuinely reports zero repositories", async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ repositories: [] }), { status: 200 })
    ) as never;
    const { listInstallationRepositories } = await import("../github-api");
    await expect(listInstallationRepositories(123)).resolves.toEqual([]);
  });

  it("returns repositories across pages, stopping once a page returns fewer than 100", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      const repos =
        call === 1
          ? Array.from({ length: 100 }, (_, i) => ({ id: i, full_name: `org/repo-${i}` }))
          : [{ id: 999, full_name: "org/repo-999" }];
      return new Response(JSON.stringify({ repositories: repos }), { status: 200 });
    }) as never;
    const { listInstallationRepositories } = await import("../github-api");
    const repos = await listInstallationRepositories(123);
    expect(repos).toHaveLength(101);
    expect(call).toBe(2);
  });
});

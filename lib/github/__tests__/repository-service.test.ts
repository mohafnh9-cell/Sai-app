import { afterEach, describe, expect, it, vi } from "vitest";
import { GITHUB_SCAN_LIMITS, GitHubRepositoryService } from "../repository-service";

const REPO_RESPONSE = {
  id: 42,
  private: false,
  default_branch: "main",
  full_name: "acme/widgets",
};

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function blobPayload(path: string, sha: string) {
  return { encoding: "utf-8" as const, content: `export const path = "${path}";`, size: 40, sha };
}

describe("GitHubRepositoryService.fetchCompareSnapshot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caps changed files at maxCompareFiles and reports the overflow", async () => {
    const total = GITHUB_SCAN_LIMITS.maxCompareFiles + 5;
    const changedFiles = Array.from({ length: total }, (_, index) => ({
      filename: `src/file-${index}.ts`,
      status: "added",
      sha: `sha-${index}`,
    }));

    let blobCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/widgets")) {
        return jsonResponse(REPO_RESPONSE);
      }
      if (url.includes("/compare/")) {
        return jsonResponse({ files: changedFiles });
      }
      const blobMatch = url.match(/\/git\/blobs\/(sha-\d+)$/);
      if (blobMatch) {
        blobCalls += 1;
        const sha = blobMatch[1];
        const index = sha.replace("sha-", "");
        return jsonResponse(blobPayload(`src/file-${index}.ts`, sha));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new GitHubRepositoryService("test-token");
    const snapshot = await service.fetchCompareSnapshot(
      { owner: "acme", repo: "widgets" },
      "base-sha",
      "head-sha"
    );
    service.dispose();

    expect(snapshot.files).toHaveLength(GITHUB_SCAN_LIMITS.maxCompareFiles);
    expect(blobCalls).toBe(GITHUB_SCAN_LIMITS.maxCompareFiles);
    expect(snapshot.omissions).toContainEqual({ reason: "max_file_count", count: 5 });
  });

  it("fetches all changed files under the cap and skips irrelevant paths", async () => {
    const changedFiles = [
      { filename: "src/app.ts", status: "modified", sha: "sha-app" },
      { filename: "notes.txt", status: "added", sha: "sha-notes" },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/widgets")) return jsonResponse(REPO_RESPONSE);
      if (url.includes("/compare/")) return jsonResponse({ files: changedFiles });
      if (url.includes("/git/blobs/sha-app")) return jsonResponse(blobPayload("src/app.ts", "sha-app"));
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new GitHubRepositoryService("test-token");
    const snapshot = await service.fetchCompareSnapshot(
      { owner: "acme", repo: "widgets" },
      "base-sha",
      "head-sha"
    );
    service.dispose();

    expect(snapshot.files.map((file) => file.path)).toEqual(["src/app.ts"]);
    expect(snapshot.omissions).toContainEqual({
      path: "notes.txt",
      reason: "unsupported_format",
    });
  });
});

describe("GitHubRepositoryService transient-failure retry (Phase 13)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries a 5xx response and succeeds once GitHub recovers", async () => {
    let repoCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/widgets")) {
        repoCalls += 1;
        if (repoCalls < 3) {
          return new Response("upstream error", { status: 502 });
        }
        return jsonResponse(REPO_RESPONSE);
      }
      if (url.includes("/compare/")) return jsonResponse({ files: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new GitHubRepositoryService("test-token");
    const snapshot = await service.fetchCompareSnapshot(
      { owner: "acme", repo: "widgets" },
      "base-sha",
      "head-sha"
    );
    service.dispose();

    expect(repoCalls).toBe(3);
    expect(snapshot.files).toEqual([]);
  });

  it("does not retry a non-transient 404 -- fails immediately", async () => {
    let repoCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/widgets")) {
        repoCalls += 1;
        return new Response("not found", { status: 404 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new GitHubRepositoryService("test-token");
    await expect(
      service.fetchCompareSnapshot({ owner: "acme", repo: "widgets" }, "base-sha", "head-sha")
    ).rejects.toMatchObject({ code: "GITHUB_NOT_FOUND" });
    service.dispose();

    expect(repoCalls).toBe(1);
  });
});

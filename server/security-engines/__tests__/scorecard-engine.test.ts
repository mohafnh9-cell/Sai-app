import { afterEach, describe, expect, it, vi } from "vitest";
import { createScorecardEngine } from "../scorecard/engine";

/**
 * Phase 35, section 30: "Scorecard: use deterministic mocked repository
 * metadata where external GitHub access would make tests unreliable" --
 * explicitly sanctioned by the brief. Real, live execution against the
 * actual hosted API (https://api.securityscorecards.dev) was independently
 * verified during this phase (see Phase 35 final report section 10) --
 * this suite mocks `fetch` only for deterministic, network-independent CI.
 */

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("ScorecardEngine", () => {
  it("surfaces only checks scoring at or below the weak-check threshold, never the whole repo score as one vulnerability", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          score: 6.1,
          repo: { name: "github.com/acme/widgets", commit: "abc123" },
          checks: [
            { name: "Token-Permissions", score: 0, reason: "detected GitHub workflow tokens with excessive permissions" },
            { name: "Maintained", score: 10, reason: "actively maintained" },
            { name: "Code-Review", score: 8, reason: "most changesets reviewed" },
          ],
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const engine = createScorecardEngine();
    const result = await engine.execute({
      scanId: "scan-1",
      projectId: "project-1",
      organizationId: "org-1",
      files: [],
      githubRepo: "acme/widgets",
      timeoutMs: 10_000,
    });

    expect(result.status).toBe("COMPLETED");
    // Only the weak check (score 0) becomes a finding -- Maintained (10) and
    // Code-Review (8) do not, proving the whole score isn't dumped as findings.
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.category).toBe("supply-chain-posture");
    expect(result.findings[0]?.title).toContain("Token-Permissions");
    expect(result.findings[0]?.severity).toBe("high");
  });

  it("SKIPS (not '0 findings = safe') when the repository isn't indexed by Scorecard (real 404 semantics)", async () => {
    global.fetch = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;

    const engine = createScorecardEngine();
    const result = await engine.execute({
      scanId: "scan-2",
      projectId: "project-1",
      organizationId: "org-1",
      files: [],
      githubRepo: "acme/private-unindexed-repo",
      timeoutMs: 10_000,
    });

    expect(result.status).toBe("SKIPPED");
    expect(result.errors[0]?.code).toBe("not_indexed");
    expect(result.findings).toHaveLength(0);
  });

  it("is not applicable without a connected GitHub repository", () => {
    const engine = createScorecardEngine();
    expect(engine.applicability({ files: [], githubRepo: null }).applicable).toBe(false);
  });
});

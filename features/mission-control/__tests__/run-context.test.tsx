import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

let lang: "en" | "es" = "es";
const lookup = (ns: string | undefined, key: string) => {
  const segments = key.split("."); const namespace = ns ?? segments.shift()!;
  let node: unknown = JSON.parse(readFileSync(`messages/${lang}/${namespace}.json`, "utf8"));
  for (const part of segments) node = (node as Record<string, unknown>)?.[part];
  if (typeof node !== "string") throw new Error(`missing i18n key ${lang}:${namespace}.${segments.join(".")}`);
  return node;
};
vi.mock("@/lib/i18n/client", () => ({ useI18n: (ns?: string) => ({ t: (key: string) => lookup(ns, key), locale: lang }) }));
vi.mock("next/link", () => ({ default: ({ children, href, className }: { children: unknown; href: string; className?: string }) => createElement("a", { href, className }, children as never) }));

import { deriveRunContext, type RunBrief } from "../lib/run-context";
import { AnalysisRunContextNotice } from "../components/AnalysisRunContextNotice";
import { LATEST_RUN_PROBE_INTERVAL_MS } from "../hooks/useLatestRunProbe";

// Acceptance of 2026-10-13: a page opened on `?run=` showed the verdict of that analysis next to a protection card derived from the
// newest one, with nothing saying so; after a push, an idle page said nothing (it only watches while a review is running).

const run = (runId: string, sha: string, createdAt: string, status = "completed") => ({
  runId, commitSha: sha.repeat(40).slice(0, 40), createdAt, completedAt: createdAt, status, branch: "main", securityScore: 100, verdictStatus: "ready_to_ship", deploymentPosture: null,
}) as never;
const R1 = run("r1", "a", "2026-10-13T10:17:00Z"), R2 = run("r2", "b", "2026-10-13T11:12:00Z"), R3 = run("r3", "c", "2026-10-13T13:00:00Z");
const base = { analysisRuns: [R3, R2, R1], latestRun: R3, productionVerdict: { scanId: "r1" }, ui: { viewingHistoricalRun: false } };
const brief = (r: { runId: string; commitSha: string | null; createdAt: string; status: string }): RunBrief => ({ runId: r.runId, commitSha: r.commitSha, createdAt: r.createdAt, status: r.status });

describe("deriveRunContext", () => {
  it("pinned to an older run from the start: says it is older, names both, and does not claim the page changed", () => {
    const n = deriveRunContext({ state: { ...base, analysisRunId: "r1" } as never, initialLatestRunId: "r3" });
    expect(n).toMatchObject({ kind: "older", selected: { runId: "r1" }, latest: { runId: "r3" } });
  });
  it("pinned to the newest run: nothing to say", () => {
    expect(deriveRunContext({ state: { ...base, analysisRunId: "r3", productionVerdict: { scanId: "r3" } } as never, initialLatestRunId: "r3" })).toBeNull();
  });
  it("a page without `run` showing the newest at load: nothing, until the probe sees a newer one -> newer_detected, and the view is NOT swapped", () => {
    const state = { ...base, analysisRunId: null, latestRun: R2, productionVerdict: { scanId: "r2" }, analysisRuns: [R2, R1] } as never;
    expect(deriveRunContext({ state, initialLatestRunId: "r2" })).toBeNull();
    const n = deriveRunContext({ state, initialLatestRunId: "r2", probedLatest: brief(R3 as never) });
    expect(n).toMatchObject({ kind: "newer_detected", latest: { runId: "r3" } });
  });
  it("a pinned page where a newer analysis appears later is 'newer_detected' (not 'older')", () => {
    const n = deriveRunContext({ state: { ...base, analysisRunId: "r2", latestRun: R2 } as never, initialLatestRunId: "r2", probedLatest: brief(R3 as never) });
    expect(n?.kind).toBe("newer_detected");
  });
  it("an active review of another scan keeps its own banner (not said twice)", () => {
    expect(deriveRunContext({ state: { ...base, analysisRunId: "r1", ui: { viewingHistoricalRun: true } } as never, initialLatestRunId: "r3" })).toBeNull();
  });
  it("without a latest run there is nothing to compare", () => {
    expect(deriveRunContext({ state: { ...base, latestRun: null, analysisRunId: "r1" } as never, initialLatestRunId: null })).toBeNull();
  });
  it("the probe is slow and read-only (60 s)", () => {
    expect(LATEST_RUN_PROBE_INTERVAL_MS).toBe(60_000);
  });
});

describe.each(["es", "en"] as const)("AnalysisRunContextNotice [%s]", (l) => {
  const render = (state: unknown) => {
    lang = l;
    return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { enabled: false } } }) }, createElement(AnalysisRunContextNotice, { state: state as never })));
  };
  const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("shows both analyses (short commit, UTC time), says decisions belong to the shown one, links to the latest", () => {
    const html = render({ ...base, projectId: "p1", analysisRunId: "r1" });
    expect(html).toContain('data-testid="analysis-run-context"');
    expect(html).toContain('data-kind="older"');
    expect(text(html)).toContain("aaaaaaa");
    expect(text(html)).toContain("ccccccc");
    expect(text(html)).toContain("2026-10-13 10:17 UTC");
    expect(text(html)).toContain("2026-10-13 13:00 UTC");
    expect(text(html)).toMatch(l === "en" ? /not to the latest one/ : /no al más reciente/);
    expect(html).toContain('href="/projects/p1/mission-control"');
  });
  it("renders nothing when the page already shows the newest analysis", () => {
    expect(render({ ...base, projectId: "p1", analysisRunId: "r3", productionVerdict: { scanId: "r3" } })).toBe("");
  });
});

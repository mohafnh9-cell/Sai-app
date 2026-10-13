import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// react-query only schedules intervals in a browser (`typeof window !== "undefined"`); declare one before it is first imported.
vi.hoisted(() => {
  (globalThis as unknown as { window?: unknown }).window = globalThis;
});
import { focusManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { LATEST_RUN_PROBE_INTERVAL_MS, latestRunProbeOptions } from "../hooks/useLatestRunProbe";
import { listAnalysisRunsForProject } from "@/server/analysis-runs/list-analysis-runs";

vi.mock("server-only", () => ({}));

// The idle probe must be cheap, read-only and well-behaved: no request at load, one every 60 s while the tab is visible, nothing while
// hidden, a catch-up when the tab returns, and no timer left behind when the page goes away.

const seed = { runId: "r2", commitSha: "b".repeat(40), createdAt: "2026-10-13T11:12:00Z", status: "completed" };
const newer = { ...seed, runId: "r3", commitSha: "c".repeat(40), createdAt: "2026-10-13T13:00:00Z" };

describe("idle probe: schedule, visibility, return to the tab, cleanup", () => {
  beforeEach(() => { vi.useFakeTimers(); focusManager.setFocused(true); });
  afterEach(() => { vi.useRealTimers(); focusManager.setFocused(undefined); });

  function start(answer: () => unknown = () => seed) {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, runs: [answer()] }) }) as Response);
    const client = new QueryClient();
    client.mount(); // what <QueryClientProvider> does: it wires the tab-focus events
    const observer = new QueryObserver(client, latestRunProbeOptions("p1", seed, Date.now(), fetchImpl));
    const seen: unknown[] = [];
    const unsubscribe = observer.subscribe((result) => seen.push(result.data));
    return { fetchImpl, observer, unsubscribe, seen, client };
  }

  it("no request at load (it is seeded with the run the server already rendered); the first is 60 s later; then one per minute", async () => {
    const { fetchImpl, unsubscribe } = start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(LATEST_RUN_PROBE_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LATEST_RUN_PROBE_INTERVAL_MS * 3);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it("every request is the same cheap read: GET, no body, limit=1, no verdicts", async () => {
    const { fetchImpl, unsubscribe } = start();
    await vi.advanceTimersByTimeAsync(LATEST_RUN_PROBE_INTERVAL_MS * 2);
    for (const [url, init] of fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(url).toBe("/api/projects/p1/analysis-runs?limit=1&verdicts=0");
      expect(init.method).toBeUndefined(); // GET
      expect(init.body).toBeUndefined();
    }
    unsubscribe();
  });

  it("while the tab is hidden nothing is requested; on return it catches up once (data older than a minute)", async () => {
    const { fetchImpl, unsubscribe } = start();
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("returning to the tab soon after a request does not ask again (fresh for a minute)", async () => {
    const { fetchImpl, unsubscribe } = start();
    await vi.advanceTimersByTimeAsync(LATEST_RUN_PROBE_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("the timer is cleaned up when the page goes away", async () => {
    const { fetchImpl, unsubscribe } = start();
    await vi.advanceTimersByTimeAsync(LATEST_RUN_PROBE_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a newer run, and an unavailable endpoint stays silent (keeps the previous answer, no retry storm)", async () => {
    let answer: unknown = seed;
    const ok = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, runs: [answer] }) }) as Response);
    const client = new QueryClient();
    const observer = new QueryObserver(client, latestRunProbeOptions("p1", seed, Date.now(), ok));
    const unsubscribe = observer.subscribe(() => undefined);
    answer = newer;
    await vi.advanceTimersByTimeAsync(LATEST_RUN_PROBE_INTERVAL_MS);
    expect(observer.getCurrentResult().data).toMatchObject({ runId: "r3" });
    unsubscribe();

    const failing = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as Response);
    const client2 = new QueryClient();
    const observer2 = new QueryObserver(client2, latestRunProbeOptions("p1", seed, Date.now(), failing));
    const unsubscribe2 = observer2.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(LATEST_RUN_PROBE_INTERVAL_MS * 3);
    expect(failing).toHaveBeenCalledTimes(3); // exactly one per minute: no retries
    unsubscribe2();
  });
});

describe("what the probe's endpoint does on the server: reads only, light mode skips the verdicts", () => {
  function spyAdmin() {
    const calls: string[] = [];
    const rows: Record<string, unknown[]> = {
      scans: [{ id: "r3", status: "completed", commit_sha: "c", branch: "main", created_at: "2026-10-13T13:00:00Z", completed_at: null, security_score: 1 }],
      production_verdicts: [{ scan_id: "r3", status: "ready_to_ship", verdict: { huge: true } }],
    };
    const chain = (table: string): unknown => {
      const proxy: unknown = new Proxy(() => undefined, {
        get: (_t, prop: string) => {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: rows[table], error: null });
          calls.push(`${table}.${prop}`);
          return () => proxy;
        },
      });
      return proxy;
    };
    return { calls, admin: { from: (table: string) => chain(table) } };
  }

  it("light mode reads the scans table only", async () => {
    const { admin, calls } = spyAdmin();
    const runs = await listAnalysisRunsForProject(admin as never, { projectId: "p", organizationId: "o", limit: 1, includeVerdicts: false });
    expect(runs).toHaveLength(1);
    expect(calls.some((c) => c.startsWith("production_verdicts"))).toBe(false);
    expect(calls.filter((c) => /\.(insert|update|upsert|delete|rpc)$/.test(c))).toEqual([]);
  });

  it("the full list (the run selector) still reads verdicts, and never writes", async () => {
    const { admin, calls } = spyAdmin();
    await listAnalysisRunsForProject(admin as never, { projectId: "p", organizationId: "o", limit: 12 });
    expect(calls.some((c) => c.startsWith("production_verdicts"))).toBe(true);
    expect(calls.filter((c) => /\.(insert|update|upsert|delete|rpc)$/.test(c))).toEqual([]);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startDynamicSecurityLab, type DynamicSecurityLab } from "@/fixtures/dynamic-security-lab/server";
import type { AuthorizedDynamicTarget } from "../dynamic/authorized-target";
import {
  createDynamicHttpClient,
} from "../dynamic/http-client";
import { createDynamicHttpConcurrencyLimiter } from "../dynamic/concurrency-limiter";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTarget(overrides: Partial<AuthorizedDynamicTarget> = {}): AuthorizedDynamicTarget {
  const origin = "http://127.0.0.1:4242";
  return {
    baseUrl: origin,
    origin,
    environment: "sandbox",
    authorized: false,
    authorization: null,
    allowedPaths: ["/api", "/"],
    pathExclusions: [],
    maxRequestBudget: 20,
    maxDurationMs: 8_000,
    attackMode: "sandbox",
    testIdentities: {},
    ...overrides,
  };
}

function trackConcurrentFetch(holdMs = 60) {
  let activeRequests = 0;
  let maxObservedConcurrency = 0;
  let totalRequests = 0;

  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    activeRequests += 1;
    totalRequests += 1;
    maxObservedConcurrency = Math.max(maxObservedConcurrency, activeRequests);
    await delay(holdMs);
    activeRequests -= 1;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });

  return {
    fetchMock,
    stats: () => ({ activeRequests, maxObservedConcurrency, totalRequests }),
  };
}

describe("dynamic HTTP concurrency limiter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TEST 1 — maxConcurrentRequests=1 caps simultaneous HTTP to 1 across 3 parallel operations", async () => {
    const limiter = createDynamicHttpConcurrencyLimiter(1);
    const tracker = trackConcurrentFetch(80);
    const client = createDynamicHttpClient({
      target: buildTarget(),
      correlationId: "concurrency-test-1",
      concurrencyLimiter: limiter,
    });

    await Promise.all([
      client.request({ method: "GET", path: "/api/a" }),
      client.request({ method: "GET", path: "/api/b" }),
      client.request({ method: "GET", path: "/api/c" }),
    ]);

    expect(tracker.stats().maxObservedConcurrency).toBeLessThanOrEqual(1);
    expect(limiter.maxObserved).toBeLessThanOrEqual(1);
    expect(tracker.stats().totalRequests).toBe(3);
    expect(limiter.activeCount).toBe(0);
  });

  it("TEST 2 — maxConcurrentRequests=2 caps simultaneous HTTP to 2 across 5 parallel operations", async () => {
    const limiter = createDynamicHttpConcurrencyLimiter(2);
    const tracker = trackConcurrentFetch(80);
    const client = createDynamicHttpClient({
      target: buildTarget(),
      correlationId: "concurrency-test-2",
      concurrencyLimiter: limiter,
    });

    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        client.request({ method: "GET", path: `/api/r${index}` })
      )
    );

    expect(tracker.stats().maxObservedConcurrency).toBeLessThanOrEqual(2);
    expect(limiter.maxObserved).toBeLessThanOrEqual(2);
    expect(tracker.stats().totalRequests).toBe(5);
    expect(limiter.activeCount).toBe(0);
  });

  it("TEST 3 — thrown request releases permit and subsequent requests continue", async () => {
    const limiter = createDynamicHttpConcurrencyLimiter(1);
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("network failure");
      }
      return new Response("{}", { status: 200 });
    });

    const client = createDynamicHttpClient({
      target: buildTarget(),
      correlationId: "concurrency-test-3",
      concurrencyLimiter: limiter,
    });

    await expect(client.request({ method: "GET", path: "/api/fail" })).rejects.toThrow(
      /network failure/i
    );
    await expect(client.request({ method: "GET", path: "/api/ok" })).resolves.toMatchObject({
      status: 200,
    });
    expect(limiter.activeCount).toBe(0);
    expect(calls).toBe(2);
  });

  it("TEST 4 — timed out request releases permit", async () => {
    const limiter = createDynamicHttpConcurrencyLimiter(1);
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const client = createDynamicHttpClient({
      target: buildTarget(),
      correlationId: "concurrency-test-4",
      concurrencyLimiter: limiter,
      timeoutMs: 30,
    });

    await expect(client.request({ method: "GET", path: "/api/slow" })).rejects.toThrow(/timed out/i);
    expect(limiter.activeCount).toBe(0);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(client.request({ method: "GET", path: "/api/next" })).resolves.toMatchObject({
      status: 200,
    });
  });

  it("TEST 5 — cancellation while waiting never executes fetch and releases permit state", async () => {
    const limiter = createDynamicHttpConcurrencyLimiter(1);
    let cancelled = false;
    const tracker = trackConcurrentFetch(120);

    const client = createDynamicHttpClient({
      target: buildTarget(),
      correlationId: "concurrency-test-5",
      concurrencyLimiter: limiter,
    });

    const blockedClient = createDynamicHttpClient({
      target: buildTarget(),
      correlationId: "concurrency-test-5b",
      concurrencyLimiter: limiter,
      isCancelled: () => cancelled,
    });

    const first = client.request({ method: "GET", path: "/api/hold" });
    await delay(20);
    cancelled = true;
    const second = blockedClient.request({ method: "GET", path: "/api/never" });

    await expect(second).rejects.toThrow(/cancelled/i);
    await first;

    expect(tracker.stats().totalRequests).toBe(1);
    expect(limiter.activeCount).toBe(0);
  });

  it("TEST 6 — exhausted budget prevents additional network requests", async () => {
    const limiter = createDynamicHttpConcurrencyLimiter(3);
    const tracker = trackConcurrentFetch(10);
    const client = createDynamicHttpClient({
      target: buildTarget({ maxRequestBudget: 2 }),
      correlationId: "concurrency-test-6",
      concurrencyLimiter: limiter,
    });

    await client.request({ method: "GET", path: "/api/1" });
    await client.request({ method: "GET", path: "/api/2" });
    await expect(client.request({ method: "GET", path: "/api/3" })).rejects.toThrow(
      /budget exceeded/i
    );

    expect(tracker.stats().totalRequests).toBe(2);
    expect(limiter.activeCount).toBe(0);
  });
});

describe("dynamic HTTP concurrency via safe runtime session", () => {
  let lab: DynamicSecurityLab;

  beforeAll(async () => {
    lab = await startDynamicSecurityLab();
    process.env.SEQURAI_DYNAMIC_LAB_ORIGIN = lab.origin;
  });

  afterAll(async () => {
    delete process.env.SEQURAI_DYNAMIC_LAB_ORIGIN;
    await lab.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TEST 7 — safe runtime session wires limiter and completes lab probe without leaking permits", async () => {
    const { createSafeRuntimeSession, executeSafeRuntimeStep } = await import("../runtime/safe-runtime");

    const session = createSafeRuntimeSession({
      mode: "sandbox",
      tenant: {
        organizationId: "66666666-6666-4666-8666-666666666666",
        projectId: "55555555-5555-4555-8555-555555555555",
        campaignId: "11111111-1111-4111-8111-111111111111",
        executionId: "22222222-2222-4222-8222-222222222222",
        correlationId: "33333333-3333-4333-8333-333333333333",
      },
      commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
      targetUrl: lab.origin,
    });

    expect(session.guard.httpConcurrencyLimiter?.maxConcurrent).toBe(3);
    expect(session.guard.limits.maxConcurrentRequests).toBe(3);

    const { result } = await executeSafeRuntimeStep(session, {
      adapterId: "unauthenticated-endpoint",
      stepKind: "execute_request",
      stepLabel: "Lab probe",
    });

    expect(result.outcome).toBe("completed");
    expect(session.guard.httpConcurrencyLimiter?.activeCount).toBe(0);
  });
});

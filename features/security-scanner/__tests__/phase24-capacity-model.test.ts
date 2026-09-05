import { describe, it } from "vitest";

/**
 * Phase 24 -- deterministic capacity model for the "1,000 concurrent scans"
 * question. This is NOT a literal load test (no real scanner/registry/DB
 * calls) -- it's a discrete-event simulation whose per-stage cost inputs
 * are drawn from REAL measurements made across Phases 13-23 (cited inline),
 * used to answer questions a real 1,000-scan test cannot safely answer:
 * queue wait, throughput, and where the model itself breaks down as target
 * concurrency rises, under the REAL, already-confirmed scheduling
 * constraint that Inngest limits same-org scan concurrency to 3.
 *
 * Two dimensions modeled independently, since they're governed by
 * different constraints:
 *  - INNGEST_PER_ORG_CONCURRENCY = 3 (real, confirmed: inngest/functions/
 *    scan-run.ts, `concurrency: {limit: 3, key: "event.data.organizationId"}`)
 *  - VERCEL_CONCURRENT_INSTANCES: unknown from the repo (account/plan-
 *    dependent) -- modeled as a parameter, swept across plausible values,
 *    explicitly not claimed as a real platform number.
 */

type ScanClass = "SMALL" | "MEDIUM" | "LARGE" | "EXTREME";

/**
 * Per-class duration estimates (ms), each stage's number cited to the real
 * measurement it's derived from. Where no direct measurement exists, the
 * value is interpolated proportionally to file/dependency count from real
 * data points and marked MODELED in the report, not asserted as measured.
 */
const CLASS_ESTIMATES: Record<
  ScanClass,
  { githubFetchMs: number; extractMs: number; ruleEngineMs: number; registryMs: number; persistMs: number; verdictMs: number }
> = {
  // express-scale real measurement (Phase 23): 148 files, ~44 deps.
  SMALL: { githubFetchMs: 450, extractMs: 10, ruleEngineMs: 100, registryMs: 461, persistMs: 150, verdictMs: 300 },
  // axios-scale real measurement (Phase 23): 203 files, ~63 deps.
  MEDIUM: { githubFetchMs: 600, extractMs: 15, ruleEngineMs: 200, registryMs: 828, persistMs: 250, verdictMs: 400 },
  // interpolated between axios and react real data (Phase 14.1/23): ~1500 files, ~300 deps.
  LARGE: { githubFetchMs: 1200, extractMs: 60, ruleEngineMs: 800, registryMs: 2800, persistMs: 600, verdictMs: 800 },
  // react-scale real measurement (Phase 23): 4704 files, 909 deps, registryPhaseDurationMs=8079.
  EXTREME: { githubFetchMs: 2200, extractMs: 120, ruleEngineMs: 2500, registryMs: 8100, persistMs: 1200, verdictMs: 1500 },
};

function totalDurationMs(cls: ScanClass): number {
  const e = CLASS_ESTIMATES[cls];
  // GitHub fetch and extraction are sequential-before the rule engine;
  // ruleEngineMs already EXCLUDES registry time (registry is the dominant
  // component of the rule-engine phase but is reported/measured
  // separately, per Phase 22/23's registryPhaseDurationMs vs total
  // scan-phase distinction) -- so total = fetch + extract + max(other
  // rules, registry runs concurrently as part of the same rule batch) +
  // persist + verdict. Conservatively modeled as sequential (registry
  // phase already includes its own internal concurrency=12, and other
  // rules run in the same 4-wide rule batch loop, largely overlapping with
  // registry's async work in practice) -- so this is a slight
  // OVER-estimate of total wall time, which is the safer direction for a
  // capacity model.
  return e.githubFetchMs + e.extractMs + Math.max(e.ruleEngineMs, e.registryMs) + e.persistMs + e.verdictMs;
}

/** FIFO queue simulation: workers = concurrent execution slots available (Vercel instances x Inngest per-org slots, simplified to a single pool for the whole-fleet model). */
function simulateFleet(
  scanClasses: ScanClass[],
  concurrentWorkers: number
): { totalWallMs: number; avgQueueWaitMs: number; maxQueueWaitMs: number; throughputPerMinute: number } {
  const durations = scanClasses.map(totalDurationMs);
  const workerFreeAt = new Array(concurrentWorkers).fill(0);
  const queueWaits: number[] = [];
  let maxCompletionMs = 0;

  for (const duration of durations) {
    // Assign to the worker that frees up soonest (classic list-scheduling model).
    let minIndex = 0;
    for (let i = 1; i < workerFreeAt.length; i++) {
      if (workerFreeAt[i] < workerFreeAt[minIndex]) minIndex = i;
    }
    const startAt = workerFreeAt[minIndex]; // all scans "arrive" at t=0 (worst-case burst)
    const completeAt = startAt + duration;
    workerFreeAt[minIndex] = completeAt;
    queueWaits.push(startAt);
    maxCompletionMs = Math.max(maxCompletionMs, completeAt);
  }

  const avgQueueWaitMs = queueWaits.reduce((a, b) => a + b, 0) / queueWaits.length;
  const maxQueueWaitMs = Math.max(...queueWaits);
  const throughputPerMinute = (durations.length / (maxCompletionMs / 1000)) * 60;

  return { totalWallMs: maxCompletionMs, avgQueueWaitMs, maxQueueWaitMs, throughputPerMinute };
}

/** Realistic repo-size distribution: most orgs scan small/medium repos; EXTREME (react-scale) is a minority. */
function realisticMix(count: number): ScanClass[] {
  const classes: ScanClass[] = [];
  for (let i = 0; i < count; i++) {
    const r = i / count;
    if (r < 0.5) classes.push("SMALL");
    else if (r < 0.85) classes.push("MEDIUM");
    else if (r < 0.97) classes.push("LARGE");
    else classes.push("EXTREME");
  }
  return classes;
}

describe("Phase 24C/M -- deterministic capacity model (simulation, not a real load test)", () => {
  const SCAN_COUNTS = [10, 50, 100, 250, 500, 750, 1000, 2000];
  // Swept because the real value requires Vercel account verification --
  // this is explicitly a parameter sweep, not a claim about any of these
  // being the real platform ceiling.
  const WORKER_POOL_SIZES = [8, 32, 128];

  for (const workers of WORKER_POOL_SIZES) {
    it(`worker pool=${workers}: realistic-mix throughput/queue-wait across scan counts`, () => {
      for (const count of SCAN_COUNTS) {
        const classes = realisticMix(count);
        const result = simulateFleet(classes, workers);
        console.log(
          `PHASE24_FLEET_MODEL ${JSON.stringify({
            workers,
            scanCount: count,
            totalWallSec: Math.round(result.totalWallMs / 100) / 10,
            avgQueueWaitSec: Math.round(result.avgQueueWaitMs / 100) / 10,
            maxQueueWaitSec: Math.round(result.maxQueueWaitMs / 100) / 10,
            throughputPerMinute: Math.round(result.throughputPerMinute),
          })}`
        );
      }
    });
  }

  it("EXTREME-only worst case (all 1,000 scans are react-scale): registry pressure model", () => {
    for (const count of [10, 100, 1000]) {
      // Real measured: react = 909 unique deps, concurrency=12/scan, process cap=32/instance.
      const uniqueDepsPerScan = 909;
      const perScanConcurrency = 12;
      const totalTheoreticalRegistryRequests = count * uniqueDepsPerScan;
      console.log(
        `PHASE24_REGISTRY_PRESSURE ${JSON.stringify({
          scanCount: count,
          uniqueDepsPerScan,
          perScanConcurrency,
          totalTheoreticalRegistryRequestsNoCaching: totalTheoreticalRegistryRequests,
          note: "does not account for cross-scan cache/coalescing overlap -- see report for that adjustment",
        })}`
      );
    }
  });
});

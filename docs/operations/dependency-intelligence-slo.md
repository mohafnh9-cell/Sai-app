# Dependency-intelligence SLOs and beta launch gate

Phase 23. Source data: real measurements across Phases 16, 18, 19, 21, 22, 23 (npm/PyPI/RubyGems/crates.io/Go, real repos axios/express/react). Not invented figures — see `registryMetrics` in `scans.metrics` for live data and the `/admin` page's "Registry / dependency-intelligence health" cards for a rolling 30-day view.

## Where the data lives

Every scan that runs `package-security.scan-packages` persists an aggregate-only `registryMetrics` object inside `scans.metrics.registryMetrics` (no new table — see `RegistryPhaseMetrics` in `features/security-analysis/package-security/types.ts`). Fields: `dependencyCount`, `uniqueDependencyCount`, `registryLookupCount`, `cacheHitCount`, `coalescedCount`, `networkRequestCount`, `p50LookupMs`, `p95LookupMs`, `p99LookupMs`, `maxLookupMs`, `registryPhaseDurationMs` (wall-clock), `sumOfLookupDurationsMs` (NOT wall-clock — do not confuse the two), `semaphoreWaitTotalMs`, `unavailableCount`, `timeoutCount`, `retryCount`. Nothing sensitive: no package names, no URLs, no response bodies.

Telemetry is best-effort everywhere it's collected — a failure to capture or persist it never fails a scan or changes a finding (see `features/security-scanner/__tests__/phase23-registry-telemetry-persistence.test.ts`).

## SLO candidates (initial, to be revised from real beta data)

| Signal | Target | Basis |
|---|---|---|
| Per-lookup p95 | ≤ 350ms | Real observed 94-319ms across every phase |
| Per-lookup p99 | ≤ 700ms | Real observed max was 597ms |
| Registry phase wall-clock, typical repo (<100 deps) | ≤ 2s | Real observed 459-893ms |
| Registry phase wall-clock, large repo (~900 deps) | ≤ 20s typical | Real observed 5.9-8.6s typical; one 90s+ outlier mechanically reproduced as a broad, non-failing latency slowdown, not a bug (Phase 22) |
| `registryUnavailable` rate | 0% under normal conditions | 0% observed in every real measurement to date |
| Timeout rate | ~0% under normal conditions | 0 timeouts observed in every real measurement to date |
| Semaphore wait (single scan) | Negligible (<50ms) | 13-16ms observed for lone scans; contention under concurrent scans is expected and not itself alarming (see fairness results, Phase 22) |

## Alert thresholds

**Registry unavailable rate** (sustained, not single-scan): WARNING >1%, CRITICAL >2-3%.
**Registry p95**: WARNING materially above the table above, CRITICAL sustained severe degradation.
**Registry phase, typical repos**: WARNING 2-3s sustained.
**Registry phase, large repos (~900 deps)**: WARNING 20s, CRITICAL repeated 60-120s broad degradation.
**Timeout rate**: WARNING any sustained non-trivial rate, CRITICAL persistent timeout behavior across scans.
**Semaphore wait**: WARNING sustained high wait under normal (non-bursty) workload, CRITICAL evidence of scan starvation or sustained saturation.

Do not alert on a single anomalous scan — these are sustained/rolling thresholds. The current stack has no dedicated alerting pipeline; until one exists, these are documented thresholds to check manually via the `/admin` page or a `scans.metrics` query, not automated pages.

## Beta launch gate

**GREEN** — launch/continue beta: scans complete normally, `registryUnavailable` near 0%, timeout rate near 0%, p95 within the table above, no semaphore starvation, no cross-tenant issues, no security regression.

**YELLOW** — investigate, do not halt beta: registry p95 materially deteriorates, semaphore wait becomes sustained, `registryUnavailable` becomes non-zero and persistent, scan duration rises materially.

**RED** — escalate to an active architecture investigation (this is the trigger for considering Redis/distributed coordination, not before): sustained registry 429s appear, sustained `registryUnavailable` >2-3%, p99 becomes consistently unacceptable, multiple instances appear to saturate external registries, scans become persistently stuck, customers experience material scan failures.

## Redis / distributed coordination decision

**Default answer: NO.** Nothing measured across Phases 16-23 shows sustained 429s, registry saturation, or customer-visible impact. The current per-process design (cache + coalescing + bounded queue + process semaphore=32) has repeatedly measured 0% unavailable and 0% timeout in real conditions, with good fairness and no starvation.

This decision changes only when the RED criteria above are actually observed in production telemetry — not on suspicion, not preemptively.

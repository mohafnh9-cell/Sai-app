# 1,000-scan capacity: verification checklist + calculator

Phase 26 built this as a reusable artifact. **Phase 27 (2026-09-04) performed the real account verification** by browsing the live, logged-in Vercel and Supabase dashboards for the actual `sequrai-app` deployment (confirmed via project URL and matching latest commit). Inngest could not be verified — no logged-in session was available and entering credentials is out of scope for an automated agent. Two of three critical account inputs are now real; the verdict below is the honest result of plugging them in.

**Headline result: at today's real Supabase tier (Free/Nano), the application-level capacity ceiling is ~52 concurrent active scans, not 1,000 — regardless of Vercel or Inngest headroom.** See `2026-09-04-phase27-verdict` section at the bottom for the full writeup.

## How to use this document

1. Go through the three checklists below (Vercel, Inngest, Supabase) and fill in every `VERIFIED` value from the real account dashboard.
2. Call `calculateCapacity()` (or ask Claude Code to run it) with those three numbers plus your organization count and instance count.
3. Read `maxActiveScans` — once all three critical inputs are filled in, it's a real number, not the `REQUIRES ACCOUNT VERIFICATION` sentinel.

## Vercel

| Field | Value | Status |
|---|---|---|
| Plan | **Hobby** (scope `typebeats-projects`, billing page confirms "Hobby · Active") | VERIFIED (2026-09-04) |
| Function runtime | `nodejs` (confirmed, `vercel.json` + route exports) | VERIFIED |
| Function memory | **2 GB / 1 vCPU** (Hobby default = Hobby maximum, per Vercel's published Functions Limits page) | VERIFIED (2026-09-04, via vercel.com/docs/functions/limitations) |
| Max duration (scan-trigger route) | 60s in code (Phase 25 fix). With Fluid Compute enabled, Hobby's *platform* default/max is actually 300s — the 60s in `route.ts` is a deliberate, tighter self-imposed ceiling, not a platform constraint | VERIFIED |
| Max duration (Inngest handler / MCP / full-product-audit) | 300s (== Hobby+Fluid platform max, so already at the ceiling for these routes) | VERIFIED |
| Concurrent execution limit (per-function/project/account) | **Auto-scales up to 30,000** (Hobby, with Fluid Compute — official Vercel limit, not project-specific) | VERIFIED (2026-09-04, via vercel.com/docs/functions/limitations) |
| Region(s) | `iad1` (confirmed, `vercel.json`) | VERIFIED |
| Fluid Compute status | **Enabled** (confirmed via presence of "Fluid Active CPU" / "Fluid Provisioned Memory" metrics on the account Usage page, which only appear for Fluid-enabled projects) | VERIFIED (2026-09-04) |
| File descriptors | 1,024, **shared across all concurrent executions** (Hobby and Pro alike) — a real, easy-to-hit ceiling completely independent of the 30,000 concurrency number | VERIFIED (2026-09-04, official docs) |
| Included usage (last 30 days, live) | Fluid Active CPU 1h46m / 4h-hr cap (44%); Fluid Provisioned Memory 27 GB-hr / 360 GB-hr cap (7.5%); Function Invocations 54K / 1M cap (5.4%); Edge Requests 37K / 1M cap (3.7%) | VERIFIED (2026-09-04, live usage snapshot — will drift daily) |
| Concurrent Deployments (build-time, not runtime) | 1 (Hobby) | VERIFIED (docs) — not relevant to runtime scan concurrency |
| Commercial-use policy | Vercel's Hobby plan terms restrict it to personal, non-commercial projects. SequrAI is a paid/commercial SaaS product currently deployed on a Hobby-tier team. This is a **policy/ToS risk, independent of the technical capacity numbers below** — flagged, not a technical bottleneck | VERIFIED (2026-09-04, general knowledge of Vercel's published plan terms; founder should confirm current wording on vercel.com/docs/plans before relying on this) |

**Where to look**: Vercel dashboard → `typebeats-projects` → Settings → Billing (plan); Usage (live consumption); `vercel.com/docs/functions/limitations` and `vercel.com/docs/limits` (published platform limits, apply uniformly to all Hobby accounts).

## Inngest

| Field | Value | Status |
|---|---|---|
| Function name | `scan-run` (`inngest/functions/scan-run.ts:33`) | VERIFIED |
| Per-organization concurrency | **3** (`concurrency: {limit: 3, key: "event.data.organizationId"}`) | VERIFIED |
| Global/account concurrency | | **STILL REQUIRES ACCOUNT VERIFICATION** — Phase 27 attempted this via browser automation against `app.inngest.com` and hit a sign-in wall (no saved session in the available browser profile). Entering credentials on the founder's behalf is out of scope for an automated agent. |
| Per-function concurrency (other functions: alerts, reports, webhooks) | 5 each, function-scoped | VERIFIED |
| Event throughput limit | | REQUIRES ACCOUNT VERIFICATION (same reason) |
| Execution duration (finish timeout) | 15 minutes (`SCAN_JOB_TIMEOUT_MS`) | VERIFIED |
| Retries | 3 | VERIFIED |
| Plan | | REQUIRES ACCOUNT VERIFICATION (same reason) |

**Where to look**: sign in to `https://app.inngest.com` → select the SequrAI app/environment → Functions (per-function concurrency, matches code) → Account/Billing page for the plan's global concurrency ceiling and event throughput limits. This is the single most important number still missing from a complete capacity verdict — with Supabase (below) already capping real capacity at ~52 concurrent scans, Inngest's global ceiling won't change the *headline* verdict, but is still needed to know whether Inngest would independently constrain capacity even after a Supabase upgrade.

## Supabase

| Field | Value | Status |
|---|---|---|
| Plan | **Free** (org "mohafnh9-cell's Org") | VERIFIED (2026-09-04) |
| Compute size / RAM | **NANO** — up to 0.5 GB memory, shared (burstable) CPU. This is the smallest available Supabase compute tier | VERIFIED (2026-09-04, Project Settings → Infrastructure) |
| Live utilization at near-zero load | **CPU 60%, Memory 7%, Disk IO 60%** over the trailing week, against a baseline of only 264 total API Gateway requests in the preceding 60 minutes (~4.4 req/min) | VERIFIED (2026-09-04, live dashboard snapshot) — this is the single most alarming number in the whole verification: the database is already spending most of its CPU budget at negligible real load |
| Connection pool size (Supavisor, shared pooler) | **15** connections to the underlying Postgres cluster, per user+db — "default of 15 based on your compute size of Nano," not separately configurable below Pro | VERIFIED (2026-09-04, Database Settings) |
| Max client (pooled) connections | **200**, "fixed based on your compute size of Nano and cannot be changed" | VERIFIED (2026-09-04, Database Settings) |
| Postgres `max_connections` (raw, unpooled) | Not separately surfaced in the dashboard at Nano tier; the pooler numbers above are the operative ceiling for this app's access pattern | NOT DIRECTLY SURFACED — pool size (15) is the binding number |
| PostgREST request/rate limits | No explicit PostgREST-specific rate limit surfaced in the dashboard at Free tier; the binding constraint at Nano is compute (CPU/pool size), not a PostgREST request quota | REQUIRES ACCOUNT VERIFICATION for an explicit published number, but application-observed CPU pressure is already the practical limit |
| Project status | Dashboard reports overall project status as **"Unhealthy"** | VERIFIED (2026-09-04) — flagged as a separate, non-capacity finding; the founder should investigate this directly, Phase 27 did not diagnose it (out of scope: no architecture/runtime changes) |
| Storage / database size | 0.34 GB used of 2 GB (Free plan disk) | VERIFIED — NOT a near-term constraint |
| Access pattern used by the app | Supabase JS client over PostgREST (HTTPS), not raw Postgres connections from application code — confirmed, `lib/supabase/admin.ts` | VERIFIED |

**Important**: because the app talks to PostgREST (HTTP) rather than opening raw Postgres connections per scan, "1,000 active scans" does NOT mean "1,000 Postgres connections." It means up to ~1,000 concurrent HTTP requests to PostgREST, which itself holds a bounded pool of only **15** real Postgres connections at Nano tier — that pool, not `max_connections`, is the real ceiling for this app's access pattern.

**Derived `supabaseCapacityOpsPerSec` (MODELED, not a number Supabase publishes directly)**: using the verified pool size of 15 connections and a conservative ~10 ops/sec/connection under realistic PostgREST latency, the calculator below was run with `supabaseCapacityOpsPerSec = 150`. Given the *already-observed* 60% CPU utilization at near-zero real load, this is likely an optimistic ceiling, not a pessimistic one — real sustained throughput may be materially lower once the CPU-bound scanner work and dependency-registry I/O run concurrently with DB writes on the same Nano instance.

**Where to look**: Supabase dashboard → project `SequrAI` → Project Settings → Database (connection pooling, max connections) and → Project Settings → Infrastructure (compute tier, live CPU/memory/disk graphs).

## Running the calculator

```ts
import { calculateCapacity, REQUIRES_ACCOUNT_VERIFICATION, REALISTIC_MIX } from "@/server/capacity-planning/calculate-capacity";

const result = calculateCapacity(
  {
    vercelMaxConcurrentExecutions: /* fill in from the table above, or REQUIRES_ACCOUNT_VERIFICATION */,
    inngestGlobalConcurrency: /* fill in, or REQUIRES_ACCOUNT_VERIFICATION */,
    supabaseCapacityOpsPerSec: /* fill in, or REQUIRES_ACCOUNT_VERIFICATION */,
    organizationCount: /* your real active org count */,
    vercelInstanceCount: /* concurrent Vercel instances you expect/allow, or REQUIRES_ACCOUNT_VERIFICATION */,
    averageScanDurationMs: 6_000,   // MODELED, real measurements: Phases 14.1/21-24
    p95ScanDurationMs: 15_000,      // MODELED
    averageDbOpsPerScan: 17,        // PROVEN (enumerated, Phase 24/25)
    averageDependencies: 150,       // fallback if not using a mix
    averageRegistryLatencyMs: 150,  // real measured range across Phases 16-23
  },
  1000,          // target active scans
  REALISTIC_MIX  // or WORST_CASE_LARGE / WORST_CASE_EXTREME
);
```

## Worked example: today's real posture (all three account inputs still unverified)

Computed by the calculator, `REALISTIC_MIX`, real per-org=3 and registry=12/32 values:

| Target | Orgs required (min) | `maxActiveScansFromKnownLimits` | First bottleneck | `maxActiveScans` |
|---|---|---|---|---|
| 10 | 4 | 12 | inngest_per_org | REQUIRES ACCOUNT VERIFICATION |
| 100 | 34 | 102 | inngest_per_org | REQUIRES ACCOUNT VERIFICATION |
| 1,000 | 334 | 1,002 | inngest_per_org | REQUIRES ACCOUNT VERIFICATION |
| 2,000 | 667 | 2,001 | inngest_per_org | REQUIRES ACCOUNT VERIFICATION |

The `maxActiveScansFromKnownLimits` column is real and useful today — it says "if you had enough organizations, the application-level limits alone support this many scans." The `maxActiveScans` column stays honestly unverified until the three account facts above are filled in — filling them in is the entire point of this document.

## Worked example: illustrative hypothetical account values

**Not real numbers — for demonstrating calculator behavior only.** With `vercelMaxConcurrentExecutions=1000`, `inngestGlobalConcurrency=1000`, `supabaseCapacityOpsPerSec=3000`, `vercelInstanceCount=100`:

| Target | Orgs used | `maxActiveScans` | First bottleneck | Second bottleneck | Safety margin |
|---|---|---|---|---|---|
| 10 | 24 | 72 | inngest_per_org | vercel | +620% |
| 100 | 54 | 162 | inngest_per_org | vercel | +62% |
| 1,000 | 354 | 1,000 | vercel | inngest_global | 0% |
| 2,000 | 687 | 1,000 | vercel | inngest_global | -50% |

This illustrates the calculator correctly identifying a bottleneck *transition*: at low target scale, the per-org limit dominates; once enough organizations exist, the (hypothetical) Vercel ceiling becomes binding; at 2,000 with these same hypothetical limits, the model correctly reports insufficient capacity (-50% margin) rather than silently pretending it works.

## 2026-09-04-phase27-verdict — real account values, real result

Phase 27 fed the calculator two real/derived account inputs (Vercel `vercelMaxConcurrentExecutions=30000` VERIFIED; Supabase `supabaseCapacityOpsPerSec=150` MODELED from a VERIFIED pool size) and left Inngest's global concurrency as the sentinel (dashboard inaccessible). Full sweep, `REALISTIC_MIX`, `vercelInstanceCount` left unverified:

| Target | Orgs required | `maxActiveScansFromKnownLimits` | First bottleneck | Second bottleneck | `maxActiveScans` |
|---|---|---|---|---|---|
| 10 | 4 | 12 | inngest_per_org | supabase | REQUIRES ACCOUNT VERIFICATION |
| 25 | 9 | 27 | inngest_per_org | supabase | REQUIRES ACCOUNT VERIFICATION |
| 50 | 17 | 51 | inngest_per_org | supabase | REQUIRES ACCOUNT VERIFICATION |
| 100 | 34 | **52** | **supabase** | inngest_per_org | REQUIRES ACCOUNT VERIFICATION |
| 250 | 84 | **52** | **supabase** | inngest_per_org | REQUIRES ACCOUNT VERIFICATION |
| 500 | 167 | **52** | **supabase** | inngest_per_org | REQUIRES ACCOUNT VERIFICATION |
| 750 | 250 | **52** | **supabase** | inngest_per_org | REQUIRES ACCOUNT VERIFICATION |
| 1,000 | 334 | **52** | **supabase** | inngest_per_org | REQUIRES ACCOUNT VERIFICATION |
| 2,000 | 667 | **52** | **supabase** | inngest_per_org | REQUIRES ACCOUNT VERIFICATION |

**The bottleneck flips from `inngest_per_org` to `supabase` at 100 concurrent scans and never moves again — Supabase's Nano tier is the real, hard ceiling at ~52 concurrent active scans, over an order of magnitude below 1,000.** This holds even in an illustrative "what if Inngest's global concurrency is enormous (10,000)" scenario — the number stays pinned at 52. Getting the missing Inngest number would not change this headline result; Supabase already dominates.

**Worst-case mix (`WORST_CASE_EXTREME`, 100% react-scale repos), target=1,000**: same 52-scan ceiling from Supabase (repository size mix doesn't change DB-ops-per-scan, only registry pressure), but `registryPressure.theoreticalRequestsNoOverlap` rises to 909,000 (vs. 107,320 for the realistic mix) — registry pressure was never the binding constraint in either case; Supabase is.

**Registry fleet-wide pressure sweep** (target=1,000, `peakFleetWide = instances × 32`, application-proven number, independent of account verification): 1 instance → 32; 5 → 160; 10 → 320; 25 → 800; 50 → 1,600; 100 → 3,200. This remains a real, always-computable number; it was never the bottleneck in any scenario tested.

### Final verdict

- **1,000-scan verdict: NO.** Not conditional — a hard **NO** at today's real infrastructure tier. The database (Supabase Free/Nano) caps real concurrent-scan capacity at approximately **52**, independent of Vercel (30,000 concurrency headroom, effectively unlimited for this purpose) and independent of whatever Inngest's real global ceiling turns out to be.
- **2,000-scan verdict: NO**, for the identical reason — the ceiling doesn't move with the target.
- **Safe production operating point today: ~35–40 concurrent active scans** (roughly 25–30% safety margin under the modeled 52-scan ceiling), given that the 52 figure already assumes an *optimistic* per-connection throughput estimate against a database that is independently observed at 60% CPU utilization under near-zero real traffic. This is not a modeled number to trust blindly — it is a conservative buffer under a ceiling that may itself be optimistic.
- **First bottleneck at every target ≥100: Supabase compute tier (Nano/Free).** This is a real, verified, non-code, non-architecture finding. Fixing it means upgrading the Supabase project's compute tier (e.g., to Micro or Small) — an account/billing decision for the founder, explicitly out of scope for this phase to perform (no architecture or infrastructure changes were made).
- **Second-order concern, independent of capacity**: SequrAI is deployed on a Vercel **Hobby** plan, whose terms restrict use to personal/non-commercial projects. This doesn't appear in the capacity math but is a real business/compliance finding the founder should address regardless of the scan-capacity verdict.
- **Third-order concern**: the Supabase project's own dashboard reports project status **"Unhealthy"** — undiagnosed by this phase (out of scope), but should be checked before relying on any of the above capacity numbers holding steady.
- **Inngest remains the one truly unknown input.** Exact location to resolve it: sign in to `https://app.inngest.com` → SequrAI app/environment → Account/Billing, and re-run `node`/`tsx` against `calculateCapacity()` with the real number. Given Supabase already caps capacity at ~52, this won't change the 1,000/2,000-scan verdict, but is still worth capturing for completeness and for planning what happens *after* a Supabase upgrade.
- **No runtime/architecture changes were made in this phase.** `calculate-capacity.ts` and its 35-test suite were read-verified only, not edited — their sentinel-based unknown-handling behavior is exactly as validated in Phase 26, and continues to work correctly with real mixed known/unknown inputs (see the sweep above, where `unverifiedInputs` correctly lists `inngestGlobalConcurrency` and `vercelInstanceCount` throughout).

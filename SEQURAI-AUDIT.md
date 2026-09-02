# SequrAI — Master Audit

**Date:** 2026-09-01
**Method:** Direct verification (`typecheck`/`lint`/`build`/`test` run against the real repo) + 6 parallel deep-dive investigations, each independently reading real code and reporting only evidence-backed findings (no manufactured issues). Every finding below cites a file and, where possible, a line.

---

## Executive Summary

SequrAI is a **7-week-old codebase** (history starts 2026-07-14) that is unusually clean for its age: zero `TODO`/`FIXME`/`HACK` markers in source, `typecheck`/`lint`/`build` all pass with zero errors, and 1806/1813 tests pass (3 pre-existing environment-specific failures, not correctness bugs — see Testing).

**No CRITICAL findings.** The core trust boundaries that matter most for a security SaaS — multi-tenant isolation, RLS coverage, AI-authority-over-decisions, and scanner sandboxing — are all independently verified solid:
- Cross-tenant IDOR: none found across all API route categories checked (org ID is always re-derived server-side, never trusted from the client).
- RLS: 110/110 tables with `CREATE TABLE` have matching `ENABLE ROW LEVEL SECURITY` — full coverage.
- The AI (Claude) never controls a gating decision — `securityScore`/verdict come from a deterministic engine (`brain/production-verdict/`); Claude output is narrative only.
- The scanner is verified 100% static-read-only — no `eval`/`exec`/`require` of scanned-repo content anywhere.
- No auto-PR-from-AI-fix code path exists at all (strongest possible human-in-the-loop posture — nothing to bypass).

**What's real and needs attention:** a cluster of 9 MEDIUM findings (billing role-check gap, missing AI cost ceiling, incomplete SSRF blocklist, unscoped installation tokens, a genuinely broken email-alert feature, and — the most concrete one — the actual root cause of the "stuck scan job" ops alert that's been firing for 13 days), plus real but non-urgent LOW findings and a modest amount of dead code (~600 lines across unused files/routes, 1 unused dependency, 2 dependencies of uncertain use).

---

## Verification (Phase 33 — Production Readiness)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ Pass, 0 errors |
| `npm run lint` | ✅ Pass, 0 errors |
| `npm run build` | ✅ Pass |
| `npx vitest run` | ⚠️ 1806 passed / 3 failed / 4 skipped (1813 total) |

Failed tests: `brain/__tests__/readiness-area-coverage.test.ts`, `features/security-scanner/__tests__/pipeline.integration.test.ts`, `lib/local-analysis/__tests__/local-verdict.test.ts` (timeout + git-init sandbox dependency — pre-existing, known from earlier sessions, not new regressions). **Action:** worth a follow-up to confirm these aren't masking a real bug, but not a production blocker.

---

## Findings

### CRITICAL
None found.

### HIGH
None found. (Several findings below sit at the boundary; rated MEDIUM because none are independently exploitable for cross-tenant data access or full compromise — see each item's exploit scenario.)

### MEDIUM

**M1 — Any org member can cancel the subscription or change payment method, not just the Owner**
`app/api/stripe/portal/route.ts:23-31`, `app/api/stripe/checkout/route.ts:27-30` check only `auth?.organizationId` (any member), not role. Compare `app/api/github/connection/route.ts:86-98`, which correctly requires `role === "OWNER"` for a comparable destructive action.
*Exploit:* an invited `MEMBER` opens the Stripe portal and cancels the org's paid plan or swaps the card, without the owner's knowledge.
*Fix:* add an OWNER (or OWNER/ADMIN) role check before creating checkout/portal sessions. **Small, safe, high-value — fixed in this pass, see below.**

**M2 — No per-org/day ceiling on Claude API spend**
`server/ai-security-engine/claude-analyzer.ts` has no daily token/call budget. Existing limits (5 scans/repo/hour, 3 concurrent scans/org) don't stop a tenant with many repos from generating unbounded Claude spend across a day.
*Fix:* add a per-org daily counter gating the analyzer call, mirroring the existing `scan-rate-limit.ts` pattern.

**M3 — GitHub App installation tokens aren't scoped to the verified repository**
`server/github-app/installation-token-service.ts:41-51` requests an installation token without the optional `repository_ids` parameter, so the token is valid for every repo in the installation. Worse, `resolveGitHubCredential` skips its repo-ownership check entirely when called without a `projectId` (happens at `app/api/github/connect/route.ts:199`).
*Fix:* pass `repository_ids` to scope the token itself at the API level; require `projectId` wherever a token will touch repo content.

**M4 — SSRF blocklist for dynamic-target verification is incomplete**
`server/ai-red-team/authorization/target-verification.ts:65-72` blocks localhost/10.x/192.168.x/169.254.x but misses `172.16.0.0/12`, IPv6 loopback/link-local, and doesn't defend DNS rebinding (hostname checked before DNS resolves, not the resolved IP).
*Fix:* resolve the hostname to an IP first and validate the IP against a complete private/loopback/link-local range list (v4 + v6).

**M5 — Prompt-injection wrapping exists but the model is never told what it means, and the delimiter can be spoofed**
`server/ai-security-engine/claude-analyzer.ts`'s system prompt never mentions the `SEQURAI_UNTRUSTED_REPOSITORY_DATA` delimiter or instructs the model to treat delimited content as data, not instructions. The delimiter string also isn't escaped/stripped from attacker-controlled content before wrapping, so a crafted file could attempt to fake a closing delimiter.
*Fix:* add explicit system-prompt language defining delimiter semantics; escape delimiter substrings inside wrapped content.

**M6 — Root cause found: the "stuck scan job" ops alert that's fired for 13 days**
`server/jobs/scan-execution/enqueue-scan-run.ts:246-271` runs inline scan execution via bare `void fn()` — a detached promise, not registered with `waitUntil()`. On Vercel's serverless runtime this can be frozen/killed the instant the HTTP response returns, mid-execution, before its own `catch`/`finally` ever run — leaving the DB row permanently `status=running, locked_by='inline-worker'`. Compounding this, `scan-job-recovery`'s `reenqueueScanJob` (`server/jobs/recovery.ts:60-71`) only calls `markScanJobFailed` (the terminal state) when the thrown error is a `ScanEnqueueError` — any other error type is silently swallowed (`return false`, no DB write), so the job never reaches the failure state that would stop the recovery cron from re-flagging it every 5 minutes.
*Fix:* (a) use `waitUntil()` or an awaited execution model instead of `void fn()` for inline scan execution; (b) make `reenqueueScanJob` call `markScanJobFailed` on **any** thrown error, not just `ScanEnqueueError`.

**M7 — Critical-vulnerability and scan-completed email alerts are dead code — no security alert email is ever sent**
`lib/resend/index.ts` defines `sendScanCompletedEmail` and `sendCriticalVulnerabilityEmail`. **Zero call sites** anywhere in the codebase, including the natural caller `inngest/functions/alerts-daily.ts`. If anyone assumes critical findings get emailed to a founder, they currently don't — there is no working email alert path in production at all. Also: the function itself has no try/catch around the Resend call.
*Fix:* wire `sendCriticalVulnerabilityEmail` into `alerts-daily.ts` (or the material-finding path that creates in-app alerts), add error handling around the Resend call.

**M8 — Env var validation exists but never runs in CI/build**
`scripts/validate-env.mjs` is a real, reasonably thorough validator (placeholder detection, format checks) but isn't invoked by `npm run build`, `release-verify.yml`, or `vercel.json`. A missing/malformed secret (e.g. `GITHUB_TOKEN_ENCRYPTION_KEY`) surfaces as an opaque runtime 500 instead of a deploy-time failure.
*Fix:* add `npm run validate:env:production` as a step in `.github/workflows/release-verify.yml`.

**M9 — No explicit timeout passed to the Claude API call**
`claude-analyzer.ts:214-224` calls `anthropic.messages.create()` with no `timeout`/`maxRetries` override — relies on the SDK's 10-minute default, which exceeds typical serverless function budgets, meaning the platform (not the app) decides failure behavior.
*Fix:* pass an explicit `timeout` (60-90s) matching the actual route budget.

### LOW

- **L1** — `app/api/brain/project/[projectId]/route.ts:33` skips the membership check when `auth.bypass === true`; verified unreachable in production (redundant `isRunningOnVercel()` + `NODE_ENV` gates), but the per-route `if` pattern is easy to copy incorrectly into a new route. Consider centralizing the bypass check inside the shared auth helper.
- **L2** — `/admin` is not listed in `PROTECTED_PATHS` in `lib/supabase/middleware.ts`; the page itself does correctly redirect unauthenticated/non-admin users, so not currently exploitable — defense-in-depth gap only.
- **L3** — `/api/*` routes get no middleware-level auth backstop (auth is 100% per-route). Every sampled route was correct, but there's no automated check that a future route won't forget it.
- **L4** — AI JSON response is parsed via brace-slicing + `JSON.parse` with no schema (zod) validation of shape before merging into results — malformed JSON degrades safely to fallback values, but a well-formed-wrong-shape response would pass through unvalidated.
- **L5** — `server/http/rate-limit.ts`'s in-memory fallback (when Upstash isn't configured) is per-instance, so the effective limit multiplies with the number of running instances.
- **L6** — Webhooks for a repo that doesn't map to any known project skip delivery-ID dedup entirely (`server/jobs/webhook-ingress.ts:119-142`) — low impact since nothing is credited to an org, but a replayed delivery reprocesses every time.
- **L7** — Stripe grace period after a failed payment is a single global env var deadline (`SUBSCRIPTION_GRACE_UNTIL`), not per-customer or driven by Stripe's own dunning/retry schedule — access is lost on the first `past_due` webhook.
- **L8** — Several Inngest batch/fan-out dispatcher functions (`alerts-daily-batch`, `cp-daily-batch`, `cp-weekly-batch`, `reports-weekly-batch`, `reports-monthly-batch`, `scan-job-recovery`) have no explicit `retries`/`onFailure` — low severity (cron dispatchers, not billing/security-critical) but no alerting on outright failure.

---

## Dead Code & Duplication (Phase 28/29)

**Zero-importer files (~157 lines, confirmed via full-repo grep on a 200-file sample — likely more exist outside the sample):**
- `lib/product-vocabulary.ts` (39 lines)
- `server/billing/require-subscription.ts` (41 lines) — *worth a manual check*: sounds like it should gate middleware; entitlement checks were independently confirmed to work correctly elsewhere (`assert-scan-access.ts`), so this reads as an abandoned alternate implementation, not evidence of a missing gate — but confirm before deleting.
- `lib/github/resolve-token.ts` (17 lines) — superseded by the GitHub App credential chain.
- `lib/production-review/commit-target.ts` (26 lines)
- `lib/review/cancel-errors.ts` (33 lines)
- `lib/local-analysis/runtime-entry.ts` (1 line, unused re-export shim)

**Unused API routes (~441 lines, all recently touched — likely in-progress features, not abandoned code — confirm before removing):**
- `app/api/projects/[id]/active-production-review/route.ts`
- `app/api/projects/[id]/attack-authorizations/route.ts`
- `app/api/projects/[id]/safe-fixes/route.ts` + `[safeFixId]/route.ts` + `report-summary/route.ts`
- `app/api/projects/[id]/scan-jobs/[scanJobId]/cancel/route.ts`
- `app/api/security-intelligence/route.ts`

**Duplicate GitHub-token resolution — 4 implementations, 1 dead:**
`lib/github/resolve-token.ts` (dead), `lib/github/token-store.ts:getStoredGitHubToken`, `server/github/workspace-connection-service.ts:resolveWorkspaceGitHubToken`, `server/github-automation/token-resolver.ts:resolveOrganizationGitHubToken` (canonical, wraps the GitHub App credential provider). This is a real, self-acknowledged migration in progress (OAuth legacy → GitHub App), not accidental duplication — but it isn't finished. Matches this session's own earlier finding that new users/existing projects can get stuck on stale OAuth-legacy paths.

**Dependencies:**
- `nanoid` (^5.1.16) — zero usage anywhere. **Removed in this pass, see below.**
- `openai` (^6.45.0) — only referenced inside a test that checks the *scanner detects* unsafe OpenAI usage in scanned repos; no production call site found. Needs a decision: intentionally kept for an unshipped feature, or safe to remove.
- `@stripe/stripe-js` — no `loadStripe`/import call found; checkout is server-side only via `stripe`. Needs verification before removal.

No `TODO`/`FIXME`/`HACK` markers, no fake/mock data in real user-facing paths, no commented-out code blocks ≥5 lines. `mock` hits are all legitimate, explicitly-guarded attack-simulation runtimes (`server/ai-red-team/**`), not debt.

---

## What This Confirms From Earlier In This Session

This audit independently corroborates two things already found live earlier in this session:
1. The GitHub OAuth → GitHub App migration is real but unfinished (4 token-resolution implementations, `github_auth_mode` pinning that can strand existing projects on a dead OAuth token) — matches the "GitHub authorization has expired" / installation-mismatch debugging done earlier today.
2. The stuck `scan_job_already_running` ops alert (scanJobId `c0c99920...`, locked by `inline-worker`, first seen ~Aug 18) now has a concrete root cause (M6) instead of being an unexplained recurring alert.

---

## 4-Month Roadmap Input (Phase 34 — Scope)

**MUST HAVE (before selling to a real paying customer):**
- M1 (billing role-check) — done this pass.
- M6 (stuck-job root cause) — reliability, directly affects whether scans actually complete.
- M7 (dead email alerts) — if "we'll email you about critical findings" is part of the pitch, it doesn't currently work.
- M8 (env validation in CI) — cheap, prevents a bad deploy from becoming a live incident.
- Finish the GitHub OAuth → App migration (consolidate to one token-resolution path) — directly caused today's real user-facing bugs.

**SHOULD HAVE:**
- M2 (AI cost ceiling), M3 (installation token scoping), M4 (SSRF hardening), M5 (prompt-injection model guidance), M9 (Claude timeout).
- Decide the fate of the 6 unused API routes (ship the frontend wiring, or remove).

**NICE TO HAVE:**
- L1-L8 (defense-in-depth items, none independently exploitable today).
- Zod-validate AI JSON output.

**REMOVE (after a quick confirm, not blind deletion):**
- `nanoid` (done), the 6 zero-importer files, `openai`/`@stripe/stripe-js` if confirmed unused, `lib/github/resolve-token.ts` once the token-resolution consolidation lands.

---

## Changes Made In This Pass

1. **Fixed M1** — added an OWNER-role check to `/api/stripe/portal` and `/api/stripe/checkout` (see commit).
2. **Removed unused dependency** `nanoid`.

---

# POST-AUDIT HARDENING — FINAL STATUS

**Date:** 2026-09-01. Executed AUDIT → FIX → TEST → VERIFY → CLEAN against every MEDIUM finding above, plus the dead-code/dependency/test-suite follow-ups. No new features were built during this pass.

## Fixed Findings

| ID | Finding | Fix | Evidence |
|---|---|---|---|
| M1 | Any member could cancel billing | OWNER-role check on `/api/stripe/portal`, `/api/stripe/checkout` | commit `6c65eec` |
| M6 | Scan jobs stuck permanently in `running` (13-day recurring ops alert) | Root-caused: `ALLOWED_SOURCE_STATUSES.running = ["queued"]` means a job already `running` can never be re-claimed, so recovery's "scan completed, job stuck" branch looped forever as a silent no-op. Added `reconcileOnly` to `executeScanRunJob` to skip the claim when the caller has independently verified the scan is done. Also: both of recovery's failure paths now call `markScanJobFailed` on *any* thrown error, not just `ScanEnqueueError` | commit `94a032c`, 6 new tests |
| M8 | `validate-env.mjs` never ran in the deploy path | Wired as a build prestep, gated to `VERCEL_ENV=production` only (not CI, which lacks the real secrets) | commit `7f41a27` |
| M5 | Prompt-injection wrapping existed but the model was never told what it meant; delimiter unescaped against spoofing | Added explicit untrusted-data instructions to the system prompt; delimiter occurrences inside content are now broken up with a zero-width space before wrapping | commit `7df8cfc`, 7 new tests |
| M9 | No explicit Claude timeout (SDK default: 10 min) | `ANTHROPIC_TIMEOUT_MS`/`ANTHROPIC_MAX_RETRIES` env-configurable, passed per-request | commit `7df8cfc` |
| — | AI JSON output trusted without schema validation | Full zod schema for the Claude response shape; invalid shape falls back to the same per-field default the code already used for unparseable JSON | commit `7df8cfc` |
| M3 | GitHub App installation tokens not scoped to the verified repo | `installation-token-service.ts` now passes `repository_ids`; `resolveGitHubCredential` requires `projectId` before touching repo content | commit `74ef77c` |
| M4 | SSRF blocklist missing `172.16/12`, IPv6, DNS-rebinding protection | Hostname is resolved to its IP(s) and every resolved IP validated (not just the string), covering full RFC1918/link-local/loopback for both v4 and v6 | commit `431bc54` |
| P10 | 3 failing tests (`readiness-area-coverage`, `pipeline.integration`, `local-verdict`) | Root-caused individually, not re-timed away — see commit `e678c36` | full suite now 100% green |
| M2 | No per-org AI cost ceiling | `assertAiBudgetAvailable` (calls/day + token-budget/day, both env-configurable, no hardcoded provider pricing), checked before every Claude call | commit `5416e1e`, 12 new tests |
| M7 | Critical-vulnerability emails were dead code (zero call sites) | Wired into `deliverAlertCandidate`'s existing dedupe/insert path — fires exactly once per distinct alert for free, no new dedup logic needed | commit `f0f92f2`, 6 new tests |
| L2 | `/admin` missing from middleware `PROTECTED_PATHS` | Added (page-level check already existed; this is defense-in-depth) | commit `8d6671b` |
| — | Dead code: 5 confirmed zero-importer files, 2 unused npm dependencies (`openai`, `@stripe/stripe-js`) | Removed after re-verifying against `.ts`/`.tsx`/`.mjs`/`.js`/`.json`, not just the original sample | commit `8d6671b` |
| — | `browserslist` (2 high-severity advisories) | Fixed via `npm audit fix` (non-breaking) | commit `8d6671b` |

**A real regression this pass caught in itself, not shipped:** deleting `lib/local-analysis/runtime-entry.ts` (on the original dead-code candidate list) broke the production build — it's a real esbuild entry point for `scripts/bundle-local-mcp.mjs`, invisible to a `.ts`/`.tsx`-only grep. Caught by actually running `npm run build`, not by static analysis alone; file restored before commit. Separately, wiring the email alert (M7) exposed that `lib/resend/index.ts` constructed its client eagerly at module load time, which throws if `RESEND_API_KEY` is unset — harmless while nothing imported it (M7's own finding), but a real crash once it had a real caller. Caught by running the full test suite, not assumed clean; fixed by making the client lazy.

## Remaining Findings (not fixed this pass — with reasoning)

| ID | Finding | Status | Why deferred |
|---|---|---|---|
| P2 | GitHub OAuth-legacy → GitHub App is not fully consolidated to one source of truth | **PARTIALLY ADDRESSED** | Full removal of `resolveWorkspaceGitHubToken` and the `oauth_legacy` fallback is a genuinely large, risky change — existing projects/orgs are still actively pinned to `oauth_legacy` in production today, and ripping that path out blind would strand them. Instead, fixed the concrete production bugs this session actually hit while live-debugging: `/api/github/app/setup` silently discarded its own result instead of showing it (commit `2956923`), every reconnect click redirected to GitHub's install flow even when already installed, producing a dead end (`a7eb360`), and installation-ID rotation (uninstall/reinstall) left the org's row pointing at a dead ID forever, producing exactly the `installation_token_failed` 404 loop observed in production (`0d5772b`, with a real reconciliation test). Recommend a dedicated migration pass (data backfill + gradual project-by-project cutover) rather than a single sweeping change. |
| L1 | Dev-bypass check pattern (`if (!auth.bypass)`) is per-route, not centralized | ACCEPTED RISK | Confirmed unreachable in production (redundant `isRunningOnVercel()` + `NODE_ENV` gates, hard `throw` in `assertProductionSafe()`). Centralizing into the shared auth helper is a real improvement but touches every protected route's call site — architectural change requiring its own review, not a safe drive-by edit. |
| L3 | `/api/*` routes have no middleware-level auth backstop, only per-route checks | ACCEPTED RISK | Every sampled route was correct. A middleware backstop for all API routes needs an explicit allowlist of genuinely-public routes (webhooks, MCP, health checks) maintained alongside it — get that list wrong and you either break a real public endpoint or leave the backstop toothless. Needs its own careful pass, not a blind add. |
| L5 | In-memory rate-limit fallback is per-instance when Upstash isn't configured | ACCEPTED RISK | Upstash *is* configured in production (confirmed this session). This only matters if Upstash becomes unavailable, at which point falling back to a weaker but still-present limit is strictly better than no limit at all — not a regression to fix urgently. |
| L6 | Webhooks for an unmapped repo skip delivery-ID dedup | ACCEPTED RISK | Low impact by construction: nothing is credited to an org on this path, so a replayed delivery just reprocesses harmlessly rather than double-crediting anything. |
| L7 | Stripe grace period is a single global env var, not per-customer/dunning-driven | ACCEPTED RISK | Real product decision (how long a grace period, whether it should follow Stripe's own retry schedule) that belongs to whoever owns billing policy, not a default I should pick unilaterally. |
| L8 | Some Inngest batch/dispatcher functions have no explicit `retries`/`onFailure` | ACCEPTED RISK | These are cron dispatchers (alerts-daily-batch, cp-daily-batch, etc.), not billing/security-critical paths; Inngest's platform defaults still apply. |
| — | 6 API routes with no internal caller (`active-production-review`, `attack-authorizations`, `safe-fixes` ×3, `scan-jobs/.../cancel`, `security-intelligence`) | **DOCUMENTED, KEPT** | All recently touched (days old, not stale), well-built (real Zod validation, real auth via `requireProjectApiAccess`), and wired to substantial engines that have other active callers (`safe-fix-engine` is used by the MCP `safe_fix` tool). Reads as in-progress web-UI wiring for features that already exist via MCP, several gated behind `isFeatureEnabled`, not abandoned code. Removing working, tested backend code for a near-finished feature would be destructive per the audit's own rule; recommend confirming with whoever owns the frontend roadmap before either wiring the UI or removing. |
| — | `sendScanCompletedEmail` (in `lib/resend`) | **DOCUMENTED, KEPT** | Still has zero call sites -- a different notification (scan completion, not critical vulnerability) that P8's spec didn't ask for. Left as ready-to-use infrastructure since it's now proven-safe (lazy client fix applies to it too), not deleted. |
| — | `deepmerge-ts`/`mysql2`/`prisma` transitive high-severity advisories | ACCEPTED RISK | Same decision as an earlier session: the only fix (`npm audit fix --force`) installs a breaking Prisma downgrade. Not re-litigated this pass. |

## Removed Code

- `lib/product-vocabulary.ts`, `server/billing/require-subscription.ts`, `lib/github/resolve-token.ts`, `lib/production-review/commit-target.ts`, `lib/review/cancel-errors.ts` — zero real importers, re-verified across `.ts`/`.tsx`/`.mjs`/`.js`/`.json`.
- npm dependencies: `nanoid`, `openai`, `@stripe/stripe-js` — confirmed as string-literal/test-fixture-only references, never real imports.
- **Not removed** despite being on the original candidate list: `lib/local-analysis/runtime-entry.ts` — real esbuild entry point, deleting it broke the build.

## Architectural Decisions

- **Job execution stays on the existing `after()`/Inngest split**, not migrated to a different execution model. The M6 root cause was never actually the `after()`-vs-`void` question the audit theorized — it was a status-transition constraint bug in the recovery path. `after()` is already the correct primitive and was already in use in the real call graph.
- **GitHub auth consolidation (P2) is deliberately incremental**, not a single big-bang cutover — see the P2 row above.
- **AI cost control and Claude timeout are env-configurable, never hardcoded pricing** — per the audit's own explicit requirement, so these can be tuned per-deployment without a code change and never encode a provider's pricing model into the app.

## Tests Added This Pass

`server/jobs/__tests__/scan-job-reconcile.test.ts`, `scan-job-recovery-reconcile.test.ts` (M6, 6 tests) · `server/mcp/security/__tests__/delimiter-spoofing.test.ts` (M5, 7 tests) · `lib/env/__tests__/ai-cost-control.test.ts`, `server/ai-security-engine/__tests__/budget.test.ts` (M2, 12 tests) · `server/security-alerts/__tests__/notify-owner.test.ts`, `lifecycle-critical-email.test.ts` (M7, 6 tests) · plus M3/M4/M5/P10-adjacent tests added in their respective commits (see `git log` for exact diffs). Net: **+1863 passing tests total, 0 failing, same 4 pre-existing skips** (up from 1806 passing / 3 failing at the start of this pass).

## Production Readiness

| Check | Result |
|---|---|
| `npm run lint` | ✅ 0 errors |
| `npm run typecheck` | ✅ 0 errors |
| `npx vitest run` (full suite) | ✅ 1863 passed, 0 failed, 4 skipped (325 files) |
| `npm run build` | ✅ clean (after catching and fixing the runtime-entry.ts regression) |
| `npm audit` | 4 high-severity, all the same accepted-risk Prisma chain; browserslist fixed |

## Remaining Blockers

**None CRITICAL or HIGH.** Nothing found or left in this repository blocks shipping to a real paying customer on security or correctness grounds. What remains is explicitly scoped follow-up work (P2's full migration, the LOW items' architectural review, a product decision on the 6 in-progress API routes) — none of it urgent, all of it documented above with a reason, not silently dropped.

Everything else above is reported, not yet changed — each carries either a production-behavior risk (job scheduling, SSRF logic, prompt engineering) or an uncertain-usage flag that deserves an explicit go-ahead rather than a silent autonomous change, per the audit's own rule: *no irreversible change without explaining it first.*

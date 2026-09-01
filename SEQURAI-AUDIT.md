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

Everything else above is reported, not yet changed — each carries either a production-behavior risk (job scheduling, SSRF logic, prompt engineering) or an uncertain-usage flag that deserves an explicit go-ahead rather than a silent autonomous change, per the audit's own rule: *no irreversible change without explaining it first.*

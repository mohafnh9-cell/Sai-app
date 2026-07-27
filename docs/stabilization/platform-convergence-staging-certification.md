# Platform Convergence — Staging Certification

**Date:** 2026-07-27  
**Commit SHA:** `941162c47e01efea4e7723e0aaeb4c64582ebb48`  
**Certification command (staging URL):** `npm run validate:platform-convergence:staging`  
**Certification command (main / single Vercel deployment):** `npm run validate:platform-convergence:main`  
**Unit/snapshot gate:** `npm run validate:platform-convergence`

---

## Main-environment certification (single deployment)

SequrAI may use **one** branch (`main`) and **one** Vercel deployment as the only validation environment. There is **no** separate staging branch or second deployment.

Main certification is **opt-in only** and does **not** weaken the default production host guard used by the staging certification command.

### Required safeguards (all must be true)

| Control | Purpose |
|---------|---------|
| `ALLOW_MAIN_CERTIFICATION=1` | Explicit operator opt-in |
| `MAIN_CERTIFICATION_CONFIRMATION=I_UNDERSTAND_THIS_USES_THE_MAIN_ENVIRONMENT` | Typed confirmation |
| `STAGING_CERT_ORG_ID` / `STAGING_CERT_PROJECT_ID` | Scoped org/project (names retained for compatibility) |
| `CERTIFICATION_PROJECT_IDS` | Allowlist; must include the project id |
| Project name prefix `[CERT]` | Visible certification/test marker in the product |
| `CERTIFICATION_FIXTURE_REPOSITORIES` | Non-production GitHub fixture only |
| `MAIN_CERTIFICATION_URL` | Must match `NEXT_PUBLIC_APP_URL` origin exactly |
| Fault injection env **unset** | Blocks Scenario C on live runs |
| Destructive cert flags **unset** | No cleanup / destructive suites |
| **Scenario A only** | Live main runs reject B/C/D |

### Risks and limitations

- Certification runs against the **same database and deployment** as normal operation; misconfigured scope can mutate a real project.
- Only the dedicated **`[CERT]`** project + fixture repo + allowlisted ids may be used — never point certification env at customer orgs.
- **Scenario C** (fault injection) and **Scenario D** (persistence failure simulation) are **not** permitted via `validate:platform-convergence:main`; use unit tests (`certification-fault.test.ts`, verdict idempotency tests) instead.
- **`NODE_ENV` is not** the sole safety control; URL patterns, opt-in vars, project allowlists, and fixture repos enforce scope.
- Staging command behavior is unchanged: it still **refuses** known production host patterns unless legacy `PLATFORM_CONVERGENCE_CERT_ALLOW_PRODUCTION=1` (staging path only).

### Safe Scenario A commands (main)

**Preflight (no DB scan inspect):**

```bash
export ALLOW_MAIN_CERTIFICATION=1
export MAIN_CERTIFICATION_CONFIRMATION=I_UNDERSTAND_THIS_USES_THE_MAIN_ENVIRONMENT
export MAIN_CERTIFICATION_URL="$NEXT_PUBLIC_APP_URL"
export STAGING_CERT_ORG_ID="<cert-org-uuid>"
export STAGING_CERT_PROJECT_ID="<cert-project-uuid>"
export CERTIFICATION_PROJECT_IDS="$STAGING_CERT_PROJECT_ID"
export CERTIFICATION_FIXTURE_REPOSITORIES="your-org/platform-convergence-fixture"
export FEATURE_RT9_BUSINESS_LOGIC=1
export FEATURE_LLM_RED_TEAM=1

npm run validate:platform-convergence:main -- --preflight-only --skip-flag-check
```

**After a completed scan on the `[CERT]` project (inspect one job):**

```bash
export STAGING_CERT_SCAN_JOB_ID="<completed-scan-job-uuid>"
export STAGING_CERT_SCENARIO=A

npm run validate:platform-convergence:main -- --inspect
```

**Poll until job completes (bounded timeout):**

```bash
npm run validate:platform-convergence:main -- --poll --timeout-ms=900000
```

Implementation: `scripts/lib/platform-convergence-certification.mjs`, `scripts/run-platform-convergence-certification.mjs`.

---

## 1. Preconditions and environment status

| Prerequisite | Status | Notes |
|--------------|--------|-------|
| `STAGING_BASE_URL` | **Missing in cert runner env** | Required for staging certification |
| Staging Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) | **Present** (host only verified; no secrets logged) |
| `STAGING_CERT_ORG_ID` / `STAGING_CERT_PROJECT_ID` | **Missing** | Set before live inspect/poll |
| RT9 / RT10 feature flags | **Not verified live** | Use `FEATURE_RT9_BUSINESS_LOGIC`, `FEATURE_LLM_RED_TEAM` on staging workers |
| Migrations applied | **Not verified in this run** | Run `npm run validate:migrations` against staging DB |
| Background job runner (Inngest / inline) | **Not verified live** | Use `npm run validate:phase1-staging` |
| Mission Control API | **Available** at `GET /api/projects/[id]/mission-control` (feature flag `mission_control`) |
| Production verdict persistence | **Enabled in code path** | `generateAndPersistProductionVerdict` + idempotency side effects |

**Preflight result (this workspace):** `NO-GO` — missing `STAGING_BASE_URL`, `STAGING_CERT_ORG_ID`, `STAGING_CERT_PROJECT_ID`.

```bash
node scripts/validate-platform-convergence-staging.mjs --preflight-only --skip-flag-check
```

---

## 2. Staging scenarios executed

| Scenario | Description | Live staging | Automated coverage |
|----------|-------------|--------------|-------------------|
| **A** | Normal hybrid scan, RT9+RT10, director pipeline | **Not run** (no cert project/job IDs) | E2E + convergence snapshots |
| **B** | RT10 disabled, RT9 enabled | **Not run** | Manual: disable `FEATURE_LLM_RED_TEAM`, re-scan; inspect `teamExecution` |
| **C** | Red-team partial failure | **Not run** | `ALLOW_PLATFORM_CONVERGENCE_FAULT_INJECTION=1` + `PLATFORM_CONVERGENCE_CERT_INJECT_FAULT` on worker (remove after) |
| **D** | Metadata persistence retry | **Not run** | Idempotency via `hasCompletedSideEffect` on production verdict key |

### How to run Scenario A on staging

1. Pin fixture repo (see `fixtures/staging-platform-convergence/README.md`).
2. Set env: `STAGING_CERT_ORG_ID`, `STAGING_CERT_PROJECT_ID`, `STAGING_BASE_URL`.
3. Trigger a full product scan (webhook or schedule) with RT9/RT10 enabled.
4. Export completed job id: `STAGING_CERT_SCAN_JOB_ID=<uuid>`.
5. Inspect:

```bash
STAGING_CERT_SCENARIO=A npm run validate:platform-convergence:staging -- --inspect
# or wait for completion:
STAGING_CERT_SCAN_JOB_ID=<uuid> npm run validate:platform-convergence:staging -- --poll --timeout-ms=900000
```

---

## 3. Persisted metadata evidence

**Live DB rows:** not captured (staging inspect not executed).

**Runtime validator:** `server/platform-convergence/validate-platform-metadata.mjs`

Required shape:

- `scan_jobs.metadata.platform` and/or `metadata.platformConvergence`
- `platform.version === "1.0.0"`
- `platform.ids` with correlation/execution/director mapping
- Team status, metrics, intelligence summary, `teamRunIds` (when teams run)

---

## 4. Single-verdict evidence

**Rule:** Exactly one `production_verdicts` row per `scan_id` for the active certification scan.

**Implementation:** `buildIdempotencyKey` + `hasCompletedSideEffect` before insert; early return loads existing verdict by scan.

**Versioned rows:** Only duplicate rows for the **same** `scan_id` are certification failures. Historical verdicts for **other** scans on the same project are expected.

**Live query:** Staging script check `single_verdict_per_scan`.

---

## 5. Mission Control evidence

Mission Control loads:

- Latest **completed** scan job with `metadata.platform` / `platformConvergence` (`get-mission-control.ts`)
- Current production verdict via `getCurrentProductionVerdict`

Staging script check `mission_control_db_parity` compares decision id in metadata vs verdict JSON (same sources MC uses).

**Requirement:** MC must not depend on ephemeral Security Director objects — **satisfied in code** (DB-backed only).

---

## 6. Correlation-ID matrix

| Field | Expected value |
|-------|----------------|
| `correlationId` | `scanId` |
| `executionId` | `scanJobId` |
| `directorRequestId` | `scanId` |

Validated by `validateIdentifierMatrix` in staging script and unit tests.

---

## 7. Retry and failure results

| Case | Expected behavior | Evidence |
|------|-------------------|----------|
| Red-team fault injection | Scanner completes; pipeline `failed`; no `securityDecisionId` on verdict when decision null | `certification-fault.test.ts` |
| Metadata persist failure | Operational event `PLATFORM_METADATA_PERSIST_FAILED`; retry same job id | `persist-scan-platform.ts` |
| Verdict retry | Same idempotency key → no second verdict | `production-verdict/core.ts` |
| Scan complete retry | `markScanJobCompleted` noop + side effect guard | Phase 1 staging docs |

---

## 8. Legacy path audit

| Entrypoint | scanJobId | Classification | Action |
|------------|-----------|----------------|--------|
| `executeScanRunJob` → `InlineScanJobRunner` | **Always** | production-supported | **A** Unified pipeline when not `review_only` |
| `enqueue-scan-run` / `schedule-scan` | Created before run | production-supported | **B** Job created first |
| `inngest/functions/scan-run.ts` | From event payload | production-supported | **A** |
| `review_only` scans (MCP/onboarding) | Often present | internal / transitional | Unified phase skipped by design; documented |
| `InlineScanJobRunner` without `scanJobId` | Missing | **legacy / unsupported for full persist** | **C** Logs `platform_convergence_skipped_no_scan_job`; verdict scanner-only |
| `request-red-team-run` / director API | N/A | internal / API | Not product scan path |
| Vitest / E2E director.run | N/A | test-only | N/A |

**review_only:** Explicit; does not persist full platform metadata or production verdict merge path for red team in the same way as product scans.

---

## 9. Global decision-store audit

| Check | Status |
|-------|--------|
| Persisted `verdict.securityDecisionId` primary for MCP | **Yes** — overlay prefers persisted fields |
| In-memory `globalProjectDecisionStore` fallback | **Transitional** — used only when persisted decision ids absent |
| Fallback telemetry | **Added** — structured `security_decision_in_memory_fallback` warn |
| Cross-org isolation | **Hardened** — snapshot stores `organizationId`; `getLatest` filters mismatch |
| Fallback cannot override newer persisted decision | **Yes** — early return when `verdict.securityDecisionId` set |
| Production flow depends on memory store | **No** for normal post-scan MCP answers after verdict persist |

**Release blocker:** None for decision store; monitor fallback warn volume in staging.

---

## 10. Telemetry audit

| Event | Location |
|-------|----------|
| Scan started | `scan-job-runner` → `scan_started` |
| Unified phase started | `platform_convergence_started`, `unified_red_team_phase_started` |
| Director / teams | Security Director logger (`intelligence_completed`, team events) |
| Metadata persist ok/fail | `operational_events` via `persistScanJobPlatformMetadata` |
| Verdict persisted | `verdict_persistence_completed`, `verdict_created` |
| MC read | API route (no separate event yet) — **acceptable beta debt** |
| Fallback decision store | `security_decision_in_memory_fallback` |
| Convergence skipped | `platform_convergence_skipped_no_scan_job` |

Correlation fields: pass `scanId`, `scanJobId`, `organizationId`, `projectId` on convergence logs and persist events.

---

## 11. Traceability audit

**Persisted chain (target):** Scan → Director (requestId = scanId) → RT9/RT10 runs (`teamRunIds`) → Intelligence (`intelligenceReportId`) → Decision (`decisionId`) → Verdict → Mission Control.

**AttackFinding graph/invariant parent refs:** Not fully exported on finding metadata for cross-layer trace.

**Classification:** **High-priority debt** (not blocking RT11 staging cert once live scan passes; blocks full attack-graph traceability in MC).

---

## 12. Files created or modified

| Path | Change |
|------|--------|
| `scripts/lib/platform-convergence-certification.mjs` | Certification environment guards |
| `scripts/run-platform-convergence-certification.mjs` | Shared inspect/poll runner |
| `scripts/validate-platform-convergence-main.mjs` | Main-environment certification CLI |
| `scripts/validate-platform-convergence-staging.mjs` | Staging URL certification CLI (unchanged command) |
| `server/platform-convergence/__tests__/certification-env.test.ts` | Guard unit tests |
| `server/platform-convergence/validate-platform-metadata.mjs` | Runtime metadata validation |
| `server/platform-convergence/__tests__/validate-platform-metadata.test.ts` | Validator tests |
| `server/platform-convergence/__tests__/certification-fault.test.ts` | Scenario C hook test |
| `server/platform-convergence/types.ts` | `teamRunIds`, `intelligenceSummary` |
| `server/platform-convergence/build-scan-metadata.ts` | Convergence alias + team run ids |
| `server/platform-convergence/persist-scan-platform.ts` | Persist failure telemetry |
| `server/platform-convergence/run-scan-red-team.ts` | Cert fault injection gate |
| `server/platform-convergence/execute-unified-scan-pipeline.ts` | Phase start log |
| `server/security-scanner/scan-job-runner.ts` | Skip warn + convergence start log |
| `server/ai-red-team/decision/project-decision-store.ts` | Org-scoped get |
| `server/mcp/security-decision-overlay.ts` | Fallback telemetry |
| `server/mcp/tools/can-i-deploy.ts` | Org passed to overlay |
| `fixtures/staging-platform-convergence/README.md` | Fixture spec |
| `package.json` | `validate:platform-convergence:staging` |
| `docs/stabilization/platform-convergence-staging-certification.md` | This document |

---

## 13. Commands and tests executed

```bash
npm run validate:platform-convergence          # 6 tests, snapshots updated
node scripts/validate-platform-convergence-staging.mjs --preflight-only --skip-flag-check
git rev-parse HEAD
```

---

## 14. Remaining blockers

1. **Live staging Scenario A–D** not executed — missing cert env and completed scan job id in this environment.
2. **Mission Control read telemetry** — optional operational event (beta debt).
3. **AttackFinding parent reference export** — high-priority debt.
4. **Pinned staging fixture repo commit** — owner to create/link GitHub fixture and record SHA after first live run.

---

## 15. Final release decision

### **NO-GO** (staging persistence path not certified)

**Reason:** Preconditions for live staging validation are incomplete in the certification runner environment, and no completed staging scan job was inspected (`STAGING_CERT_SCAN_JOB_ID`).

**Unit/snapshot convergence:** Green.

**To reach GO:** Run Scenario A (and B–D) on staging, attach JSON output from `validate-platform-convergence-staging.mjs --inspect`, confirm single verdict and identifier matrix, then update this document with observed ids (no secrets) and change decision to **GO**.

**CONDITIONAL GO** applies only after live Scenario A passes with documented owner-assigned debt (MC read telemetry, AttackFinding trace) and a deadline — not before Scenario A evidence exists.

---

## Evidence references

- Architecture: `docs/architecture/platform-convergence.md`
- E2E report: `docs/stabilization/e2e-platform-validation-report.md`
- Phase 1 staging: `docs/architecture/phase1-staging-validation.md`

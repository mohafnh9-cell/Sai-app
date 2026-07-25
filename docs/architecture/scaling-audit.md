# SequrAI Scaling Audit

**Date:** 2026-07-23  
**Scope:** `sequrai-app` repository — current implementation vs scale target (10K+ active users, path to 100K+)  
**Status:** Phase 1 implemented (2026-07-23) — async scan jobs via Inngest with `SCAN_SCHEDULER` rollback flag.

---

## Executive summary

SequrAI is a **Next.js 16 monolith on Vercel** with **Supabase Postgres** as the sole runtime database. The product loop (signup → GitHub → scan → Production Verdict → Continuous Reviews) is **functionally complete** for private beta but **architecturally coupled to serverless HTTP lifecycles**.

All heavy work previously ran via **`InlineScanJobRunner`** scheduled with Next.js **`after()`**. **Phase 1** introduces **Inngest-backed `scan_jobs`** with a feature-flagged scheduler (`SCAN_SCHEDULER=inline|inngest`). Webhook ingestion now acks in **<30s** and enqueues durable work; scan execution, verdict generation, and notifications run in background workers.

---

## 1. Current architecture map

```mermaid
flowchart TB
  subgraph Client
    Browser[Next.js UI]
    MCPStdio[mcp/stdio-bridge.mjs]
  end

  subgraph Vercel["Vercel monolith"]
    Proxy[proxy.ts]
    API[app/api/** — 23 routes]
    Actions[server/actions/*]
    AuthCB[app/auth/callback]
  end

  subgraph Auth["Auth & tenancy"]
    SupaAuth[Supabase Auth]
    Orgs[(organizations = workspaces)]
    RLS[Postgres RLS + service role bypass]
  end

  subgraph Data["Data"]
    PG[(Supabase Postgres)]
    Migrations[database/migrations 001–019]
    PrismaRef[prisma/schema.prisma — build only]
  end

  subgraph Compute["Background compute in-process"]
    After[Next.js after()]
    Runner[InlineScanJobRunner]
    Orch[github-automation/orchestrator]
    AutoReview[automatic-review/run-on-push]
  end

  subgraph Domain["Domain logic"]
    Scanner[features/security-scanner]
    VerdictEngine[brain/production-verdict]
    Brain[server/brain read models]
    MCP[server/mcp — 5 tools]
    AI[server/ai-security-engine]
  end

  subgraph External
    GH[GitHub API + Webhooks]
    Anthropic[Anthropic Claude]
    StripeStub[Stripe stubs]
    ResendLib[Resend library, barely wired]
  end

  Browser --> Proxy --> API
  MCPStdio --> API
  API --> PG
  GH --> API
  API --> After --> Runner
  After --> Orch --> AutoReview --> Runner
  Runner --> Scanner --> VerdictEngine --> PG
  Runner --> GH
  API --> AI --> Anthropic
```

### Layer inventory

| Layer | Implementation | Key paths |
|---|---|---|
| Frontend | Next.js 16 App Router, Tailwind v4, shadcn | `app/`, `features/`, `components/` |
| Edge / proxy | Session refresh, locale cookie | `proxy.ts`, `lib/supabase/middleware.ts` |
| Auth | Supabase Auth (email + GitHub OAuth) | `app/(auth)/*`, `app/auth/callback/route.ts` |
| Tenancy | `organizations` + `organization_members` + active workspace | `server/workspaces/*`, migration `018` |
| OLTP DB | Supabase Postgres via `@supabase/supabase-js` | `lib/supabase/*`, `types/database.ts` |
| Schema SoT | SQL migrations (19 files) | `database/migrations/` |
| Prisma | `prisma generate` only — **not used at runtime** | `prisma/schema.prisma` |
| Scan execution | `after(InlineScanJobRunner)` | `server/security-scanner/scan-job-runner.ts` |
| Webhooks | 202 + `after(orchestrator)` | `app/api/webhooks/github/route.ts` |
| Verdict | Deterministic engine + `production_verdicts` upsert | `brain/production-verdict/`, `server/production-verdict/core.ts` |
| AI | Optional Claude Sonnet (60s route) | `server/ai-security-engine/`, `app/api/scans/[id]/ai-analysis/route.ts` |
| Cache | None | In-memory rate limit: `server/http/rate-limit.ts` |
| Queue | None | — |
| Billing | Stub | `app/api/stripe/*` |
| Tests | 58 Vitest files | Strong unit coverage; no API E2E |

### Product loop (today)

```
Signup → Supabase Auth
  → Onboarding (create_organization_with_owner RPC)
  → GitHub OAuth (workspace_github_connections + projects)
  → POST /api/repositories/:id/scans
  → after(InlineScanJobRunner)
  → production_verdicts
  → Dashboard / MCP can_i_deploy

Push → POST /api/webhooks/github [202 + after]
  → orchestrator → autopilot check
  → runAutomaticProductionReview (inline in after)
  → InlineScanJobRunner (persistMode: review_only)
  → finalizeProjectStateAfterAutomaticReview
```

### Scan entry points (all converge on `InlineScanJobRunner`)

| Trigger | File | Scheduling |
|---|---|---|
| Manual web review | `app/api/repositories/[repositoryId]/scans/route.ts` | `after(() => runner.run(...))` → 202 |
| MCP `review_now` | `server/review-now/trigger-review.ts` | `after()` via injectable scheduler |
| GitHub push (autopilot) | `server/github-automation/orchestrator.ts` → `server/automatic-review/run-on-push.ts` | **Inline inside webhook `after()`** |
| GitHub automation scan | `server/github-automation/orchestrator.ts` | Same webhook background context |

### API routes with extended duration

| Route | `maxDuration` (route file) | `vercel.json` override |
|---|---|---|
| `app/api/repositories/[repositoryId]/scans/route.ts` | 300 | **60** (conflict) |
| `app/api/webhooks/github/route.ts` | 300 | **60** (conflict) |
| `app/api/mcp/route.ts` | 60 | 60 |
| `app/api/scans/[scanId]/ai-analysis/route.ts` | 60 | 60 |

**Risk:** `vercel.json` sets `app/api/**` to 60s globally. Route-level exports may not win in all deployment configurations. Treat as **P0 config debt**.

---

## 2. Existing bottlenecks

| ID | Bottleneck | Evidence | Impact at scale |
|---|---|---|---|
| B1 | Scan compute on Vercel serverless | `InlineScanJobRunner` via `after()` | Timeouts, no horizontal workers |
| B2 | `vercel.json` 60s vs route 300s | `vercel.json`, scan/webhook routes | Unpredictable prod kill mid-scan |
| B3 | Webhook runs full scan inline | `runAutomaticProductionReview` synchronous in `after()` | One webhook = one long invocation |
| B4 | No durable queue | No Inngest/Bull/SQS | No spike absorption, weak retries |
| B5 | In-memory rate limiting | `server/http/rate-limit.ts` | Ineffective on multi-instance Vercel |
| B6 | Single Postgres for all workloads | Events, findings, AI, notifications in PG | Connection pool exhaustion |
| B7 | Monolithic scan runner | Sequential fetch → scan → persist | No domain-parallel workers |
| B8 | Scanner slice budget 5s | `features/security-scanner/config.ts` | Large repos → partial coverage |
| B9 | AI on Vercel 60s route | `ai-analysis/route.ts` | Blocks serverless |
| B10 | MCP shares serverless budget | `app/api/mcp/route.ts` | `review_now` contends with limits |
| B11 | Serverless DB connections | New connection per invocation | Pool saturation |
| B12 | No artifact store | Re-fetch from GitHub every scan | Rate limits + latency |

---

## 3. Critical risks for scaling

| Risk | Severity | Description |
|---|---|---|
| Scan/worker coupled to HTTP lifecycle | **P0** | OOM/timeout loses work; no durable retry independent of request |
| Webhook duplicate delivery under load | **P1** | DB idempotency exists; cross-instance scan lease races remain |
| Verdict vs scan state mismatch | **P1** | Hardened recently; still same process — trust risk on partial failure |
| GitHub rate limits | **P1** | No global ETag cache; no installation-level concurrency |
| Token encryption env drift | **P1** | `GITHUB_TOKEN_ENCRYPTION_KEY` required for encrypted tokens |
| RLS + admin client split | **P1** | Writes via service role — tenant checks must be in application code |
| Prisma/schema drift | **P2** | Two schema sources; Prisma enums ≠ live scan statuses |
| Migration 004 destructive | **P2** | Wrong re-apply destroys scan tables |
| Billing not implemented | **P2** | No metered limits on scans/AI |
| No pipeline observability | **P2** | No queue depth, scan p95, AI cost metrics |
| Autopilot default ON | **P2** | Migration `014` — amplifies webhook→scan load per push |

---

## 4. Components that can remain unchanged (near term)

Portable domain logic — move **invocation**, not **implementation**:

| Component | Path |
|---|---|
| Production Verdict engine | `brain/production-verdict/*` |
| Security scanner rules | `features/security-scanner/**` |
| Review-now decision brain | `brain/review-now/decision.ts` |
| Automatic review decision | `brain/automatic-review/*` |
| Repository sync brain | `brain/repository-sync/*` |
| Brain read-model builders | `server/brain/*` |
| MCP tool surface (ADR-001) | `server/mcp/tools/*`, `tool-definitions.ts` |
| Onboarding flow logic | `features/onboarding/onboarding-flow.ts` |
| i18n | `messages/**`, `lib/i18n/*` |
| UI components | `features/production-verdict/components/*`, dashboard |
| GitHub HMAC verification | `server/github-automation/webhook-utils.ts` |
| Webhook delivery idempotency | `server/github-automation/delivery-idempotency.ts` |
| Workspace/org model | `server/workspaces/*`, migrations 015–019 |
| Token encryption | `lib/crypto/token-encryption.ts` |
| Unit test suites | `brain/__tests__`, `server/mcp/__tests__`, scanner tests |

---

## 5. Components that must be refactored

| Component | Current | Target | Priority |
|---|---|---|---|
| Scan scheduling | `after(InlineScanJobRunner)` × 3 | **Inngest `scan/run` + `scan_jobs` table** (Phase 1) | P0 → mitigated |
| Webhook orchestrator | Full pipeline in `after()` | **Ack → idempotency → Inngest `github/webhook.process`** (Phase 1) | P0 → mitigated |
| Runner hosting | Inside Vercel | Inngest step / Fly worker | P0 |
| Rate limiting | In-memory | Upstash Redis per org/IP | P1 |
| AI pipeline | Vercel 60s route | AI worker + router | P1 |
| Safe Fix generation | UI/brain only | Dedicated job | P1 |
| Notifications | Stub | Notification worker + Resend | P1 |
| `vercel.json` limits | Global 60s | Thin API gateway config | P0 |
| `trigger-review.ts` | Hardcoded `after` | Shared scheduler | P0 |
| Event/analytics storage | Postgres tables | ClickHouse | P2 |
| Database host | Supabase | Neon (same SQL) | P2 |
| Auth | Supabase Auth | Clerk + WorkOS (enterprise) | P3 |
| Stripe | Stubs | Real billing + meters | P2 |

---

## 6. Missing infrastructure

| Target | Status |
|---|---|
| Inngest / durable workflow | ❌ |
| Upstash Redis | ❌ |
| External scan workers (Fly/Railway) | ❌ |
| Cloudflare R2 | ❌ |
| ClickHouse | ❌ |
| AI Router (multi-model) | ❌ |
| Distributed locks (beyond DB index) | ⚠️ Partial |
| Job DLQ / replay | ❌ |
| Sentry / Axiom / Grafana | ❌ Not in repo |
| Clerk / WorkOS | ❌ |
| Neon / PgBouncer | ❌ |
| Stripe production | ❌ Stub |
| Resend production wiring | ❌ Library only |
| Regional worker pools | ❌ |

---

## 7. Database and migration risks

### Current state

- **19 SQL migrations** (`001`–`019`), applied via `npm run db:apply-migrations`
- **Runtime:** Supabase JS only; admin client for scans/webhooks/MCP
- **Prisma:** build artifact; **schema drift** from live DB (enum names, status values)

### Key tables under load

`organizations`, `projects`, `scans`, `scan_findings`, `production_verdicts`, `repository_events`, `repository_scan_state`, `workspace_github_connections`, `mcp_api_keys`, AI tables (`ai_reports`, etc.)

### Risks

| Risk | Mitigation |
|---|---|
| Dual schema sources (Prisma + SQL) | SQL is SoT; deprecate or sync Prisma |
| Migration 004 destructive | Never re-run on prod; use Neon branches for experiments |
| RLS vs admin writes | Explicit `organization_id` checks in all worker code |
| Connection limits | PgBouncer before 1K active users |
| Table growth | Archival policy; R2 for blobs in Phase 3 |
| Supabase → Neon cutover | Same SQL; decouple auth gradually |
| In-flight scans during deploy | Feature flag dual scheduler during cutover |

---

## 8. Test coverage vs gaps

**Well covered (58 Vitest files):**

- `brain/` — verdict engine, journey, autopilot, automatic review
- `server/mcp/` — tools, auth, staleness, i18n
- `features/security-scanner/` — rules, pipeline integration
- `server/github-automation/` — webhook utils, idempotency
- `lib/crypto/`, `lib/github/oauth-*`, workspaces

**Gaps:**

- No integration tests for `app/api/**` routes
- No E2E for orchestrator push/PR flow
- No pipeline tests for `server/ai-security-engine/`
- No load/concurrency tests for scan leasing
- No E2E onboarding → scan → verdict

---

## 9. Environment and operations

**Production-required** (`scripts/validate-env.mjs`):

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_*`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_WEBHOOK_SECRET`

**Recommended:**

- `GITHUB_TOKEN_ENCRYPTION_KEY`

**Used but not validated:**

- `ANTHROPIC_API_KEY`, `RESEND_*`, `STRIPE_*`, `GITHUB_WEBHOOK_URL`, MCP bridge vars

---

## 10. Gap summary vs target architecture

| Target layer | Current | Gap |
|---|---|---|
| Control plane (Vercel UI + thin API) | ✅ Exists but runs scans | Must thin |
| Orchestration (Inngest) | ❌ | Block 1 |
| Redis | ❌ | Block 2 |
| Scan workers | ❌ | Block 3 |
| R2 | ❌ | Block 3 |
| ClickHouse | ❌ | Phase 3 |
| AI Router | ❌ | Phase 2 |
| Clerk | ❌ Supabase Auth | Phase 4 |
| Neon | ❌ Supabase hosted | Phase 3 |

---

## References

- [Target Architecture](./target-architecture.md)
- [Migration Plan](./migration-plan.md)
- [ADR-001 Single Source of Truth](../ADR_001_SINGLE_SOURCE_OF_TRUTH.md)
- [Production Verdict](../PRODUCTION_VERDICT.md)
- [Workspace GitHub Architecture](../WORKSPACE_GITHUB_ARCHITECTURE.md)

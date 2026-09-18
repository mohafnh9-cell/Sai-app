# SequrAI Security Execution Worker (Phase 35.5)

## Why this exists

Phase 35 proved OpenGrep and Trivy work for real (real taint tracking, a real CVE
match) but discovered they cannot run inside Vercel's serverless functions:
`opengrep-core` is ~173MB and Trivy plus its vulnerability database is
~316MB, against Vercel's combined function-size ceiling of roughly 250MB
unzipped, with no persistent local binary cache between invocations. This
worker is the dedicated, independently-deployable execution environment
those two engines (and future ones — Nuclei, ZAP, autonomous pentesting
agents) actually run in.

## Architecture

```
Vercel (Next.js) / MCP
  |
  | createSecurityJob()  -- billing-gated (assertOrganizationCanRunScan),
  |                         tenant-scoped, idempotent insert
  v
security_jobs table (Postgres / Supabase)
  ^
  | polls for QUEUED rows (FOR UPDATE SKIP LOCKED via claim_next_security_job)
  |
Security Execution Worker (this directory) -- a separate, long-lived process
  |
  | JobValidator -> AuthorizationValidator (server-resolved GitHub token,
  |    never a client-supplied one) -> isolated workspace -> EngineRunner
  v
SecurityEngine.execute() (server/security-engines/*, unchanged from Phase 35)
  |
  v
EngineResult -> persistEngineResults() (Phase 35) -> external_engine_findings,
  engine_executions, finding_correlations (Phase 34's table, reused)
```

## Push vs. pull (why the worker polls instead of exposing an HTTP job-submission endpoint)

Section 51/52 of the Phase 35.5 brief asks for a justified decision. This
worker **pulls**: it polls `security_jobs` for `QUEUED` rows using its own
`SUPABASE_SERVICE_ROLE_KEY`, rather than Vercel pushing jobs to a worker HTTP
endpoint. Reasoning:

- **No inbound attack surface to defend.** A pull-based worker exposes only
  `/health` and `/readiness` — neither accepts a job payload. There is no
  "submit arbitrary job" endpoint for a compromised or misconfigured caller
  to hit, and no server-to-server auth handshake to design, rotate, or get
  wrong.
- **The trust boundary already exists.** Every other privileged write path
  in this codebase authenticates via a Supabase service-role key and RLS —
  reusing that here (rather than inventing a second, worker-specific
  authentication scheme) is less new surface, not more.
- **Job spoofing is structurally impossible**, not just authenticated
  against: the worker only ever reads rows `createSecurityJob()` (server/
  security-jobs/service.ts) already wrote after billing/tenant checks. There
  is no code path where a client-supplied payload becomes a job.
- The cost is polling latency (`SECURITY_WORKER_POLL_INTERVAL_MS`, default
  2s) instead of push-immediate dispatch — an acceptable tradeoff for a
  security-scanning workload that already runs for seconds to minutes.

## Job lifecycle

`QUEUED → RUNNING → {COMPLETED | FAILED | CANCELLED | TIMED_OUT}`, plus
`QUEUED → REJECTED`. Enforced by `server/security-jobs/state-machine.ts` —
an invalid transition throws rather than silently corrupting job state.
Idempotency: at most one `QUEUED`/`RUNNING` job per `(scan_id, engine)` pair
(a partial unique index), so a duplicate MCP/API retry returns the existing
in-flight job instead of creating a second one.

## Security boundary

- **Credentials**: the worker process itself holds `SUPABASE_SERVICE_ROLE_KEY`
  (needed to claim jobs and persist results) and resolves a GitHub token
  server-side per job via the existing `resolveOrganizationGitHubToken()` —
  but neither of those, nor any other credential, is ever passed into an
  engine subprocess's environment. `server/security-engines/subprocess/
  safe-exec.ts`'s `envAllowlist` is the single point every subprocess spawn
  goes through, and it only ever contains `PATH`/`NODE_ENV` plus an explicit,
  small, engine-specific allowlist — never `process.env` wholesale.
- **Filesystem**: every job gets a fresh `mkdtemp`-created workspace, removed
  in a `finally` block regardless of success/failure/timeout/cancellation.
  Repository-supplied file paths are treated as untrusted and resolved
  through `resolveSafeWorkspacePath()`, which rejects (rather than writes)
  any path that would escape the workspace directory — this closes a real
  path-traversal gap found and fixed during this phase in `TrivyEngine`
  (it previously `join()`ed an unsanitized repository-supplied path
  directly).
- **Process execution**: `safeExec()` always uses `spawn(..., {shell:
  false})` with an argument array — no shell string is ever built by
  concatenation, and repository content is never executed (`npm install`,
  build scripts, Git hooks, etc. are never run by this worker).
- **Network**: each job carries a `network_policy` (`NONE` for OpenGrep/
  Crypto, `REGISTRY_ONLY` for Trivy's DB fetch, `AUTHORIZED_EXTERNAL` for
  Scorecard's hosted API) — enforced today by which engines actually make
  outbound calls (none of the current four engines accept an arbitrary
  target URL), and recorded so a future dynamic-testing engine's target
  resolution reuses the existing `authorize_dynamic_target` /
  `assertHostnameResolvesToPublicAddress` SSRF-protection machinery
  (`server/ai-red-team/authorization/target-verification.ts`) rather than a
  new one.
- **Billing/authorization**: enforced once, at `createSecurityJob()`, via
  the same `assertOrganizationCanRunScan()` every other scan-creation path
  uses. The worker never re-derives organizationId/userId/entitlement from
  anything client-supplied — it only ever consumes a job row the server
  already authorized.

## Local development

```bash
# 1. Install the engines locally (macOS example)
brew install trivy
curl -L -o opengrep.tar.gz \
  https://github.com/opengrep/opengrep/releases/download/v1.30.0/opengrep-core_osx_aarch64.tar.gz
tar -xzf opengrep.tar.gz && chmod +x opengrep-core

# 2. Point the worker at them
export OPENGREP_BINARY_PATH=/path/to/opengrep-core
export TRIVY_BINARY_PATH=$(which trivy)
export TRIVY_CACHE_DIR=/tmp/sequrai-trivy-cache

# 3. Run it (bundles with esbuild, then runs the bundle with plain node --
#    no ts-node/tsx dependency needed, same pattern as build:mcp-local)
npm run worker:dev
```

`curl localhost:8080/health` and `curl localhost:8080/readiness` should
respond immediately; `/readiness` reports each engine's real detected
version or an honest reason it's unavailable.

## Production deployment

1. Apply migration `063_security_jobs.sql` (see the Phase 35.5 report —
   **not applied automatically**, this is a manual/CI deploy step like
   every other migration in this repo).
2. Build and push `worker/Dockerfile` to your container registry.
3. Run it as a long-lived service (Fly.io, Railway, Cloud Run with min-
   instances ≥ 1, ECS/Fargate, or a Kubernetes Deployment — any environment
   that isn't Vercel's function runtime). Required env: `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SECURITY_WORKER_ENABLED=true` (set on the
   Vercel side, not the worker, to start creating jobs — see below).
4. Set `SECURITY_WORKER_ENABLED=true` in the Vercel project's environment
   once a worker is actually running and healthy — this is the flag
   `execute-unified-scan-pipeline.ts` checks before creating OpenGrep/Trivy
   `security_jobs` rows instead of letting those two engines self-skip.
5. Point container health checks at `/health` (liveness) and `/readiness`
   (readiness — do not route traffic/mark ready until this returns
   `ready: true`).

### Resource profile (documented per section 32)

| | Value |
|---|---|
| Runtime | Node 22, Debian bookworm-slim base |
| CPU | 1 vCPU minimum (2 recommended for OpenGrep+Trivy running concurrently) |
| RAM | 2GB minimum (OpenGrep taint analysis and Trivy's in-memory vuln DB are the two heaviest consumers) |
| Disk | 1GB minimum (Trivy's vulnerability DB is ~112MB, cached at `TRIVY_CACHE_DIR`) |
| Network | Outbound HTTPS to your Supabase project and to `mirror.gcr.io` (Trivy DB) / `api.securityscorecards.dev` (Scorecard) |
| Concurrency | `SECURITY_WORKER_MAX_CONCURRENT_JOBS` (default 3) |

## Known limitation

This worker has been verified to run correctly (bundle boots, `/health`
and `/readiness` both respond correctly, all four engines report real
detected versions) against the real production Supabase project during
this phase — but migration `063` has **not** been applied there yet, so
`claim_next_security_job` does not exist in production today and the
worker's poll loop currently gets (and correctly logs) an honest "function
not found" error rather than silently succeeding. See the Phase 35.5
report's Production Deployment Requirements section.

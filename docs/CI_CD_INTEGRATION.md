# SequrAI CI/CD Integration (Phase D.8)

SequrAI integrates with your delivery pipeline as an **enforcement adapter** — not a second scanner or verdict engine.

```
Git commit / PR
      │
      ▼
GitHub webhook (existing) ──► scan job ──► generateProductionVerdict()
      │                                              │
      │                                              ▼
      │                                    GitHub Check Run
      │                                    "SequrAI — Production Verdict"
      ▼
CI workflow (optional)
      │
      ├── GET  /api/projects/{id}/ci/status   poll verdict for exact SHA
      └── POST /api/projects/{id}/ci/scan     ensure scan (push only; idempotent)
```

## Design principles

1. **One Production Verdict** — `brain/production-verdict/engine.ts` is the only scoring engine.
2. **No duplicate scans** — push/PR events are already handled by GitHub webhooks. CI primarily **polls** status.
3. **Exact SHA authority** — branch names and PR numbers alone never identify a verdict. Commit SHA is required.
4. **Fail closed** — unknown, stale, or pending states never map to `success`.
5. **D.7 correlation** — when CI runs a local audit at the same SHA, use `POST /api/projects/{id}/local-correlation`.

## Authentication

| Method | Use case |
|--------|----------|
| Session cookie | Dashboard / internal testing |
| `Authorization: Bearer seq_live_…` | GitHub Actions with MCP API key |
| `Authorization: Bearer oat_…` | OAuth MCP token |

Every request is scoped to `organization → project` server-side. Cross-tenant access returns 404.

## Endpoints

### GET `/api/projects/{projectId}/ci/status`

Poll the canonical Production Verdict for an exact commit.

Query parameters:

| Param | Required | Description |
|-------|----------|-------------|
| `commitSha` | yes | Full or abbreviated Git SHA (min 7 hex chars) |
| `prNumber` | no | Pull request number (uses `pull_request_scans`) |
| `headSha` | no | PR head SHA (defaults to `commitSha`) |
| `baseSha` | no | PR base SHA (informational) |

Response includes:

- `scanPhase`: `missing` \| `queued` \| `running` \| `completed` \| `failed`
- `productionVerdict`: canonical persisted verdict (when completed)
- `checkRun.conclusion`: `success` \| `failure` \| `action_required` \| `neutral`
- `stale`: `true` when PR head moved after the stored scan
- `correlation.ready`: `true` when D.7 local ↔ GitHub correlation can run

### POST `/api/projects/{projectId}/ci/scan`

Idempotently ensure a scan exists. **Use for push / `workflow_dispatch` only.**

For pull requests, the existing webhook pipeline owns scanning. POST returns `awaiting_webhook` when no PR scan exists yet.

Body:

```json
{
  "commitSha": "abc123…",
  "forceNew": false
}
```

## Check Run mapping (unchanged)

| Production Verdict | Check conclusion |
|--------------------|------------------|
| `ready_to_ship` | `success` |
| `not_ready` / `almost_ready` | `failure` |
| `insufficient_data` | `action_required` |
| pending / missing scan | `neutral` |

Check name: **SequrAI — Production Verdict**

## Branch protection

SequrAI does **not** modify branch protection automatically. In GitHub repository settings, add a required status check:

> **SequrAI — Production Verdict**

## GitHub Actions example

See `examples/github-actions/sequrai-production-verdict.yml`.

### Setup checklist

1. **Connect your repository** in SequrAI (Integrations → GitHub App or OAuth).
2. **Create a project** linked to that repository. Note the project UUID.
3. **Create an MCP API key** (Settings → MCP / API keys). Copy the `seq_live_…` key once — it is not shown again.
4. **Add GitHub repository secrets:**

   | Secret | Value |
   |--------|--------|
   | `SEQURAI_API_KEY` | Your `seq_live_…` key |
   | `SEQURAI_PROJECT_ID` | Project UUID from step 2 |
   | `SEQURAI_BASE_URL` | Your SequrAI app URL (e.g. `https://app.sequrai.com`) |

5. **Copy the workflow** from `examples/github-actions/sequrai-production-verdict.yml` into your repo as `.github/workflows/sequrai-production-verdict.yml`.
6. **Open a pull request** or push to `main`. The workflow polls SequrAI for the exact commit SHA.

### What the workflow conclusions mean

| `checkRun.conclusion` | Meaning | Workflow result |
|----------------------|---------|-----------------|
| `success` | Production Verdict: ready to ship | Job passes |
| `failure` | Blockers found — do not merge | Job fails |
| `action_required` | Insufficient data — human review needed | Job fails |
| `neutral` | Scan pending or not started | Keeps polling |
| `stale=true` | PR head moved — waiting for fresh scan | Keeps polling (not success) |

SequrAI does **not** block merges automatically. In GitHub → **Settings → Branches → Branch protection**, add a required status check:

> **SequrAI — Production Verdict**

Required secrets:

- `SEQURAI_API_KEY` — MCP API key (`seq_live_…`)
- `SEQURAI_PROJECT_ID` — project UUID
- `SEQURAI_BASE_URL` — e.g. `https://app.sequrai.com`

## Idempotency

Deterministic key: `sequrai-ci:{projectId}:{commitSha}:{prNumber|push}`

Existing webhook idempotency (`github_delivery_id`, `resolveReviewIdempotency`, Check Run `external_id`) is unchanged.

## Observability

Structured logs use `component: ci-enforcement`, `triggerSource: ci`. Tokens are never logged.

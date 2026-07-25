# Phase 1.6 — Staging Environment Checklist

## Required variables

| Variable | Value | Required when |
|---|---|---|
| `SCAN_SCHEDULER` | `inngest` | Staging async validation |
| `INNGEST_EVENT_KEY` | from Inngest dashboard | `SCAN_SCHEDULER=inngest` |
| `INNGEST_SIGNING_KEY` | from Inngest dashboard | `SCAN_SCHEDULER=inngest` |
| `INTERNAL_OPS_TOKEN` | random 32+ char secret | Health endpoint |
| `SCAN_JOB_QUEUE_STALE_MINUTES` | `10` | Recovery (default ok) |
| `SCAN_JOB_RECOVERY_MAX_ATTEMPTS` | `3` | Recovery (default ok) |
| `STAGING_BASE_URL` | `https://staging.*` | Load tests + validation |
| `GITHUB_WEBHOOK_SECRET` | staging secret | Webhook scenarios |
| `LOAD_TEST_CONFIRM` | `yes` | Destructive scenarios only |
| `LOAD_TEST_ALLOW_LOCALHOST` | `true` | Local load tests only |
| `STAGING_TEST_ORG_ID` | org UUID | Fault injection (I, J) |
| `OPS_ALERT_WEBHOOK_URL` | Slack webhook (optional) | Alert routing |

## Validate locally before deploy

```bash
npm run validate:env:staging
```

Expected: fails clearly when `STAGING_BASE_URL` or `INTERNAL_OPS_TOKEN` missing. Secrets reported as `[set, length=N]` never as values.

## After deploy

```bash
# 401 without token
curl -s -o /dev/null -w "%{http_code}\n" $STAGING_BASE_URL/api/internal/jobs/health

# 200 with token
curl -s -H "x-sequrai-ops-token: $INTERNAL_OPS_TOKEN" \
  $STAGING_BASE_URL/api/internal/jobs/health | jq '.schedulerMode,.alerts.healthy'
```

## Production defaults remain safe

- `SCAN_SCHEDULER` unset → `inline`
- `INTERNAL_OPS_TOKEN` unset → health returns 401 for all requests
- Load tests refuse non-staging hostnames
- `INNGEST_ASYNC_ORG_ALLOWLIST` unset → all orgs use Inngest when scheduler is inngest

## Progressive cutover (production)

```
SCAN_SCHEDULER=inngest
INNGEST_ASYNC_ORG_ALLOWLIST=<beta-org-uuid-1>,<beta-org-uuid-2>
```

Only listed orgs use async pipeline; others stay inline.

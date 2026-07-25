# Phase 1.6 — Alert Routing

## Implemented routing

Alerts are evaluated in:

- `GET /api/internal/jobs/health` (on each authorized poll)
- `runScanJobRecovery()` (after each recovery cron cycle)

When thresholds breach, the system emits structured logs:

```json
{
  "component": "ops-alerts",
  "alertId": "stuck_jobs",
  "severity": "critical",
  "message": "Stuck scan jobs detected",
  "value": 2,
  "threshold": 0
}
```

Optional webhook delivery via `OPS_ALERT_WEBHOOK_URL` (Slack-compatible `{ "text": "..." }`).

## Alert conditions

| Alert ID | Condition | Severity |
|---|---|---|
| `stuck_jobs` | `stuckJobs > 0` | critical |
| `queue_wait_p95_high` | queue wait p95 > 2 min | warning |
| `permanent_failure_rate_high` | failed / created > 1% (24h) | critical |
| `timeout_rate_high` | timeouts / created > 1% (24h) | critical |
| `failed_jobs_spike` | > 10 failed jobs in 15 min | critical |
| `recovery_exhausted` | recovery_exhausted events > 0 (24h) | critical |
| `duplicate_side_effects` | duplicate_scan_prevented > 0 (24h) | critical |
| `inngest_signing_failures_spike` | > 5 signing failures in 15 min | warning |
| `health_unavailable` | health endpoint 500 | critical (logged on failure) |

## Vercel setup

1. **Log drain** → connect to your log provider (Axiom, Datadog, etc.)
2. Create monitors on JSON field `component = "ops-alerts"`
3. Route `severity=critical` to PagerDuty/on-call
4. Route `severity=warning` to Slack `#ops-warnings`

Example Axiom query:

```
['component'] == 'ops-alerts' and ['severity'] == 'critical'
```

## Inngest setup

1. Dashboard → Alerts → function failure rate > 5% for `scan-run`
2. Cron missed runs for `scan-job-recovery`
3. Failed `onFailure` handlers visible in Runs tab

## Health polling (recommended)

Schedule an external cron (GitHub Action, UptimeRobot) every 5 minutes:

```bash
curl -sf -H "x-sequrai-ops-token: $INTERNAL_OPS_TOKEN" \
  https://staging.example.com/api/internal/jobs/health | jq '.alerts'
```

Alert when HTTP != 200 or `.alerts.healthy == false`.

## Environment variables

```bash
INTERNAL_OPS_TOKEN=        # required for health endpoint
OPS_ALERT_WEBHOOK_URL=     # optional Slack webhook
```

Never log token values. Health endpoint returns aggregate counts only.

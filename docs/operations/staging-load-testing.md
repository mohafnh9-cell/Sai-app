# Staging Load Testing

## Safety guards

- Requires `STAGING_BASE_URL` with `staging` in hostname
- Blocks production domains by default
- Destructive scenarios require `LOAD_TEST_CONFIRM=yes`
- Localhost allowed only with `LOAD_TEST_ALLOW_LOCALHOST=true`

## Automated scenarios (script)

```bash
# Duplicate webhook (scenario D)
STAGING_BASE_URL=https://staging.example.com \
  GITHUB_WEBHOOK_SECRET=... \
  node scripts/staging-load-test.mjs --scenario=duplicate-webhook

# Webhook burst (scenario E)
STAGING_BASE_URL=https://staging.example.com \
  GITHUB_WEBHOOK_SECRET=... \
  LOAD_TEST_CONFIRM=yes \
  node scripts/staging-load-test.mjs --scenario=webhook-burst
```

## Manual scenarios

| ID | Scenario | Method |
|---|---|---|
| A | 10 simultaneous manual scans | UI or API with staging auth |
| B | 50 queued scans across orgs | Script against staging projects |
| C | 5 scans one org (concurrency 3) | Verify Inngest queue depth |
| F | Controlled worker failure | Revoke GitHub token mid-scan |
| G | Retry/recovery validation | Kill function + wait for recovery cron |

## Report fields

The script outputs JSON with requests sent, accepted, duplicates, p50/p95/p99 latency, and estimated AI cost (0 for webhook-only scenarios).

## Never run against production

Production load tests require explicit leadership approval and isolated infrastructure.

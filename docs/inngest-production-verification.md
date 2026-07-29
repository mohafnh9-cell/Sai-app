# Inngest production verification (SequrAI)

## Vercel environment variables

When `SCAN_SCHEDULER=inngest`:

| Variable | Required | Purpose |
|----------|----------|---------|
| `SCAN_SCHEDULER` | Yes | Must be `inngest` for async scan workers |
| `INNGEST_EVENT_KEY` | Yes | Sends `scan/run` events from the app |
| `INNGEST_SIGNING_KEY` | Yes | Verifies `/api/inngest` requests from Inngest |
| `INNGEST_SIGNING_KEY_FALLBACK` | Optional | Key rotation |

Optional fallbacks:

| Variable | Purpose |
|----------|---------|
| `SCAN_USER_REVIEW_FORCE_INLINE=1` | Force inline execution (bypass Inngest for user reviews) |
| `SCAN_SCHEDULER_ORG_FALLBACK=inline` | Orgs outside allowlist run inline |

## Execution map

1. `POST /api/repositories/[id]/scans` → insert `scans` + `scheduleScanRun`
2. `createScanJob` → `scan_jobs` row (`queued`)
3. `enqueueScanRunExecution` → `inngest.send({ name: "scan/run", data })`
4. Inngest calls `GET|POST|PUT /api/inngest` → `scanRunFunction`
5. `executeScanRunJob` → `beginReviewProcessing` → `InlineScanJobRunner.run` → `fetchSnapshot(commitSha)`

Event constant: `INNGEST_EVENTS.SCAN_RUN` = `"scan/run"`.

Recovery: `scanJobRecoveryFunction` cron every 5 minutes → `runScanJobRecovery`.

## Checklist

1. Set env vars in Vercel Production → redeploy.
2. In Inngest Cloud: app synced to production URL, `/api/inngest` reachable.
3. Start Production Review → confirm `scan_job_dispatch_succeeded` in Vercel logs.
4. In Inngest: event `scan/run` received, run `scan-run` started/completed.
5. Supabase: `scan_jobs.status` moves `queued` → `running` → `completed`.
6. UI polling shows progress past “Revisión en cola”.

## Local dev

```bash
npm run dev
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Start a review and watch the Inngest dev UI for `scan/run`.

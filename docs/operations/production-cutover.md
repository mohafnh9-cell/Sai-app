# Production Cutover — Phase 1 Async Pipeline

## Prerequisites

- [ ] Migration `020` and `021` applied
- [ ] Staging checklist passed (see `docs/architecture/phase1-staging-validation.md`)
- [ ] Load test scenarios D + E passed on staging
- [ ] `INTERNAL_OPS_TOKEN` set in production
- [ ] Inngest app synced to production `/api/inngest`
- [ ] Recovery cron enabled
- [ ] Ops health monitoring configured

## Cutover steps

1. Deploy code with `SCAN_SCHEDULER=inngest`
2. Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`
3. Verify health endpoint returns `schedulerMode: "inngest"`
4. Trigger one manual scan and one webhook push
5. Monitor 48 hours (failure rate, queue wait, stuck jobs)

## Rollback

1. Set `SCAN_SCHEDULER=inline`
2. Redeploy (no migration rollback required)
3. Keep observability tables — they are additive
4. Pause Inngest recovery function if needed

## Post-cutover monitoring

See alert table in `docs/architecture/operational-observability.md`.

## Phase 2 gate

Do not start Phase 2 (Fly workers, Redis, ClickHouse) until:

- 7 days stable production metrics
- Zero P0 incidents from async pipeline
- Staging load scenarios A–G documented and passed
- Capacity estimate validated (see Phase 1.5 final report)

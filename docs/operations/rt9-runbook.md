# RT9 runbook

## Enable

Feature flag `business_logic_team`; persistence gate `isBusinessLogicPersistenceEnabled` (internal org only in tests).

## Verify

```bash
npx vitest run server/ai-red-team/business-logic
```

## Persistence

Migration: `database/migrations/040_business_logic.sql` — validated by `business-logic/persistence/__tests__/migration.test.ts`.

All store writes include `organizationId` and `projectId`.

## Safe runtime

Mock/simulation runtime profiles only (`rt9.runtime.mock` in manifest).

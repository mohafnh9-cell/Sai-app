# RT10 runbook

## Enable

`llm_team` feature flag + `SEQURAI_LLM_TEAM_MODE` (see `integration/feature-gate.ts`).

## Verify

```bash
npx vitest run server/ai-red-team/llm-team
```

## Safe runtime

`assertSafeAiExecutionMode` in `runtime/production-guard.ts` — `AI_RUNTIME_PRODUCTION_FORBIDDEN` must stay true.

Synthetic modes only for execution (`mock_llm`, `conversation_simulation`, etc.).

## Platform

Agent id `ai.llm`; metrics parsed in Mission Control (`parse-llm-metrics.ts`).

# Platform Convergence

Single execution path for production scans and red-team analysis.

## Unified flow

```
Product Scan (scan_jobs)
  → Repository fetch + static scanner
  → executeUnifiedScanRedTeamPhase
       Discovery → Security Director → RT-Core → RT9/RT10
       → Security Intelligence → Decision Engine
  → persist scan_jobs.metadata (Mission Control)
  → generateAndPersistProductionVerdict (scanner score + authoritative decision merge)
  → Mission Control reads persisted metadata + production_verdicts
```

## Correlation model

| ID | Value |
|----|--------|
| scanId | Review / scan UUID — **correlationId** |
| scanJobId | **executionId** |
| directorRequestId | scanId |
| decisionId | RT5 decision UUID |
| verdictId | `production_verdicts.id` row |

## Modules

- `server/platform-convergence/run-scan-red-team.ts` — Security Director entry
- `execute-unified-scan-pipeline.ts` — persist MC metadata
- `build-scan-metadata.ts` — flatten team metrics for `scan_jobs.metadata`
- `persist-scan-platform.ts` — Supabase writes

## Single verdict

The Production Verdict Engine still computes score/priorities from scanner findings. When the unified pipeline returns a Security Decision, `applySecurityDecisionToProductionVerdict` overrides deployment status and executive summary on the **same** persisted `ProductionVerdictV1` row.

Optional fields on verdict JSON: `correlationId`, `securityDecisionId`, `securityDeploymentVerdict`.

## Failure modes

- Red-team failure: logged; scanner verdict still persisted (no decision merge)
- Red-team partial: metadata persisted with `pipelineStatus: partial`
- Metadata persist failure: throws during scan completion
- Telemetry operational events: non-blocking

See `docs/stabilization/e2e-platform-validation-report.md` for prior E2E baseline.

# Capability system

Location: `server/ai-red-team/core/capabilities/`.

## Registration

- Core capabilities: `register-core-capabilities.ts` (graph, invariants, attacks, specialists, runtime, findings, platform integration, etc.).
- RT9 provider: `business-logic/capabilities/register-business-logic-capabilities.ts` (`rt9.business_logic.pipeline`).
- RT10 provider: `llm-team/capabilities/register-llm-capabilities.ts` (`rt10.llm.pipeline`).

## Resolution

`CapabilityRegistry.resolveDependencies()`:

- Rejects duplicate capability IDs at registration.
- Detects conflicts and missing dependencies.
- Visits dependencies in **sorted** order (not map insertion order).
- Returns sorted `satisfied` and `missing` lists.

## Resolution report

`buildCapabilityResolutionReport()` in `capability-resolution-report.ts` exposes:

requested, resolved, rejected, missing, conflicts, version decisions, final execution order, explainability.

Use this for pipeline telemetry and author-facing diagnostics.

## Stage mapping

`STAGE_CAPABILITY_MAP` in `canonical-stages.ts` binds each pipeline stage to required core capabilities.

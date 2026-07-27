# RT9 — Business Logic Security Team

RT9 analyzes **business logic risk** in payment, subscription, and workflow-heavy applications. It discovers workflows from RT1/RT2 evidence, builds provider-independent domain models and finite state machines, extracts invariants, generates abuse hypotheses, runs **bounded mock runtime** validation, and emits deduplicated findings with replay plans.

## What RT9 is not

- RT9 does **not** replace RT6 (Authentication), RT7 (API), or RT8 (Authorization).
- RT9 does **not** decide deployment — **RT5** remains the decision authority.
- RT9 does **not** execute production attacks or live HTTP mutation.
- RT9 does **not** auto-run replay — **RT11** (future) owns replay execution.

## Pipeline (coordinator)

1. Workflow / entity discovery  
2. Canonical domain model + FSM builder  
3. Invariant extraction  
4. Abuse case generation (from invariants)  
5. Specialist registry (modular, fail-isolated)  
6. Safe mock runtime (budgeted)  
7. Findings engine (evidence-gated, correlated)  
8. Platform payload → RT4, RT5 metadata, RT12, RT13, Mission Control  
9. Optional persistence (`business_logic_persistence` flag)

## Integration contracts

| Consumer | Input |
|----------|--------|
| RT4 | `SecurityIntelligenceReport.businessLogic` + `AttackFinding` rows (`domain: payments`) |
| RT5 | Deduplicated findings + `decision.metadata.businessLogicDecisionExposure` |
| RT12 | `ueeRemediationInputs` / per-finding `metadata.ueeRemediation` |
| RT13 | `asoOrchestration` / `executionPlan.businessLogicScheduling` (`autoExecute: false`) |
| Mission Control | `metadata.businessLogicMetrics` + `teamExecution.business_logic` |

## Runtime safety

- Default profile: `mock_deterministic_v1`, `allowStagingCandidate: false`
- `BUSINESS_LOGIC_RUNTIME_PRODUCTION_FORBIDDEN` must remain `true`
- `staging_candidate` mode throws at execution guard
- Budgets: plans, evaluations, runtime ms, transitions (see `runtime.config.ts`)

## Feature flags

- `business_logic_team` — enables RT9 in director pipeline (`payments` domain)
- `business_logic_persistence` — persists run artifacts to Postgres (requires team flag)

Both default to **internal** rollout (`SEQURAI_INTERNAL_ORG_IDS`).

## Persistence (migration `040_business_logic.sql`)

Run header + normalized child tables (workflows, FSMs, invariants, abuse, specialists, runtime, findings, replay plans) with org/project indexes and idempotency on `(project_id, idempotency_key)`.

## Extension guide (new specialist)

1. Implement `BusinessLogicSpecialist` (canRun, plan, analyze, summarize)  
2. Register in `register-default-specialists.ts`  
3. Use `specialist-selection` patterns for workflow/invariant/abuse linkage  
4. Do not call other specialists or runtime directly from analyze  

## Operational metrics

Structured logger events include `business_logic_team_completed`, `business_logic_runtime_completed`, `business_logic_findings_completed`, `business_logic_metrics`, `business_logic_persist_*`.

See `observability/telemetry.ts` for operational metric shape.

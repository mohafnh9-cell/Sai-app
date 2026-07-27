# Architecture inventory (stabilization)

Generated during Platform Stabilization Phase — reflects repository layout under `server/ai-red-team/`.

## RT-Core (`core/`)

- **Capabilities**: registry, resolution report, core registration
- **Declarative**: manifest types, validator, canonical stages, pipeline planner/executor, plugin registry, planning utilities
- **Contracts**: identifiers, contract registry (freeze)
- **Domain-free models**: graph, boundaries, invariants, attacks, specialists, runtime, findings, replay, evidence, confidence, severity, budget, coverage, assets, preconditions, telemetry, execution, metadata
- **Errors / safety**: `errors/rt-core-errors.ts`, `runtime/runtime-safety-policy.ts`, `replay/replay-safety-validator.ts`, `findings/finding-quality.ts`
- **Tests**: dependency rules, capability registry, declarative pipeline tests

## RT9 (`business-logic/`)

- Declarative: manifest, stage handlers, run pipeline, register plugin
- Domain: workflows, FSM, invariants, abuse, specialists, runtime, findings, replay
- Integration: platform payload, bridge, feature gate
- Persistence: Supabase store, migrations test for `040_business_logic.sql`
- Capabilities: `rt9.business_logic.pipeline`

## RT10 (`llm-team/`)

- Declarative: manifest, register, stage handlers, coordinator path
- Domain: AI discovery, execution graph, trust invariants, specialists, safe runtime, findings
- Integration: platform payload, protected assets, preconditions, feature gate
- Capabilities: `rt10.llm.pipeline`

## Dependency map

```
RT9  ──► core (declarative, capabilities, finding primitives, coverage helper)
RT10 ──► core (same)

RT9/RT10 integration ──► intelligence/decision/UEE/ASO/Mission Control (platform adapters)

RT-Core ──X── business-logic | llm-team | teams (forbidden imports)
```

## Registries & manifests

| Item | RT9 | RT10 |
|------|-----|------|
| Manifest id | `rt9.business_logic` | `rt10.llm` |
| Root capability | `rt9.business_logic.pipeline` | `rt10.llm.pipeline` |
| Plugin id | `rt9.business_logic.plugin` | `rt10.llm.plugin` |

## Feature flags

- `business_logic_team`, `llm_team` (`server/feature-flags/index.ts`)
- RT10 mode gate: `SEQURAI_LLM_TEAM_MODE`

## Issues identified (non-blocking unless noted)

- **Duplicated domain types** in RT9/RT10 vs core (accepted; incremental migration)
- **Contract tests** against RT4/RT5/RT12/RT13 are integration-level, not full matrix snapshots yet
- **RT10 persistence** not equivalent to RT9 SQL migration (accepted risk for private beta if RT10 remains analysis-only persistence)
- **No circular dependencies** in core dependency test

## Dead code / wrappers

- `runRt10FindingsPipeline` — retained for direct unit tests (documented in rt10.md)

Automated inventory smoke: `stabilization/__tests__/architecture-inventory.test.ts`.

# RT-Core architecture

RT-Core lives under `server/ai-red-team/core/` and provides domain-agnostic Red Team infrastructure for RT9, RT10, and future teams.

## Modules

| Area | Path | Role |
|------|------|------|
| Capabilities | `core/capabilities/` | Registry, resolution, core capability registration |
| Contracts | `core/contracts/` | Identifiers, stable contract registry (`contract-registry.ts`) |
| Declarative engine | `core/declarative/` | Manifests, pipeline planner/executor, plugin registry |
| Graph / boundaries | `core/graph/`, `core/boundaries/` | Shared graph and trust-boundary types |
| Invariants / attacks | `core/invariants/`, `core/attacks/` | Shared planning contracts |
| Specialists / runtime | `core/specialists/`, `core/runtime/` | Registry contracts, runtime safety policy |
| Findings / replay | `core/findings/`, `core/replay/` | Finding primitives, replay safety validator |
| Budget / coverage / telemetry | `core/budget/`, `core/coverage/`, `core/telemetry/` | Cross-team observability contracts |
| Errors | `core/errors/rt-core-errors.ts` | Unified error surface |

Version: `RT_CORE_VERSION` and `RT_CORE_DECLARATIVE_VERSION` are `1.0.0`.

## Dependency rules

- RT-Core must not import `business-logic/`, `llm-team/`, or legacy `teams/` (enforced by `core/__tests__/dependency-rules.test.ts`).
- RT9 and RT10 register team capabilities on top of `registerCoreCapabilities()`.

## Consumers

```
RT9 (business-logic) ──► RT-Core declarative pipeline + core contracts
RT10 (llm-team)      ──► RT-Core declarative pipeline + core contracts
RT4/RT5/RT12/RT13    ──► Team platform payloads (RT9/RT10 integration adapters)
Mission Control      ──► Parsed metrics from platform payloads
```

## Known debt (stabilization)

- Domain models (FSM, AI graph, specialists) remain in RT9/RT10; only findings primitives and orchestration are shared today.
- `CoreFindingImpact.businessImpact` is a generic string field, not payment-domain logic.

See also: `declarative-engine.md`, `capability-system.md`, `contract-versioning.md`.

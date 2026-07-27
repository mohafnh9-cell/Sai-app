# Declarative analysis engine

Location: `server/ai-red-team/core/declarative/`.

## Flow

1. **Manifest** (`RedTeamManifest`) describes modules, capabilities, runtime profiles, and platform adapters.
2. **Plugin registry** registers a `PluginDescriptor` (manifest + stage handlers + root capability).
3. **Pipeline planner** builds a 14-stage canonical plan and resolves capabilities.
4. **Pipeline executor** runs stages in deterministic order; `platform_integration` is skipped in-process (payloads built by team agents).

Canonical stages (`canonical-stages.ts`):

`discovery → graph → trust_boundaries → invariants → attack_generation → specialist_selection → runtime_selection → execution → evidence → confidence → findings → replay → coverage → platform_integration`

## RT9 / RT10 entrypoints

- RT9: `business-logic/declarative/run-declarative-pipeline.ts` (coordinator delegates here).
- RT10: `llm-team/declarative/register.ts` + coordinator declarative path.

## Validation

Strict manifest validation: `core/declarative/manifest-validator.ts` (`validateRedTeamManifest`).

Plugin registration optionally passes a capability registry for reference checking.

## Determinism

- Stage order follows `CANONICAL_PIPELINE_STAGE_ORDER` (fixed array).
- Capability roots and dependency walks are sorted before resolution.
- Planner sorts supported stages before building capability closure.

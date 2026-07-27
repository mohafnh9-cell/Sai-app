# RT9 (Business Logic)

Path: `server/ai-red-team/business-logic/`.

## Architecture

- **Coordinator** → `runBusinessLogicDeclarativePipeline` (RT-Core declarative engine).
- **Manifest**: `declarative/manifest.ts` (`rt9.business_logic`).
- **Capabilities**: `capabilities/register-business-logic-capabilities.ts`.
- **Platform**: `integration/` (RT4→RT5→RT12→RT13, Mission Control payloads).
- **Persistence**: `persistence/` + migration `database/migrations/040_business_logic.sql`.

## Migration status (stabilization)

| Concern | Status |
|---------|--------|
| Declarative pipeline orchestration | ✅ Via RT-Core |
| Finding severity/confidence/evidence | ✅ Aliased from core types |
| Graph/invariants/attacks/specialists/runtime | ⚠️ Domain implementations remain in RT9 (expected) |
| Duplicated orchestration vs core | ✅ Removed from coordinator path |
| Platform integration | ✅ Slice 8 pattern |

Feature flag: `business_logic_team` (`server/feature-flags/`).

Behavior regression guard: existing vitest suites under `business-logic/**/__tests__`.

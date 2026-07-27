# Runtime safety

## Core policy

`server/ai-red-team/core/runtime/runtime-safety-policy.ts` — domain-agnostic gate:

- Requires `productionMutationForbidden === true`
- Blocks `production` / `live` modes
- Blocks `staging_candidate` unless explicitly allowed
- Optional side-effect pattern checks on target labels

Teams pass mode labels and team-specific patterns (RT10 uses `runtime/production-guard.ts` for AI modes).

## RT9 / RT10 expectations

- No production mutation, payments, email send, or uncontrolled external calls during scans.
- Budget and timeout enforcement remain in team runtime layers.
- Every execution should consult core policy before side effects.

## Stabilization tests

`stabilization/__tests__/platform-stabilization.test.ts` covers blocked production modes.

See `docs/operations/rt9-runbook.md` and `rt10-runbook.md` for operational checks.

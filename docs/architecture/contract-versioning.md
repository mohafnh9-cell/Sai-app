# Contract versioning

Authoritative registry: `server/ai-red-team/core/contracts/contract-registry.ts`.

Each entry includes:

- `contractId`, `semanticVersion`, `owner`, `stability`
- Compatibility and deprecation policies
- Required / optional fields and extension points

## Stability classes

| Class | Meaning |
|-------|---------|
| stable | Safe to freeze; semver major for breaking changes |
| internal | In-process only; may change with core releases |
| experimental | Not for external consumers |
| deprecated | Compatibility-only; replacement documented |
| compatibility | Legacy AttackFinding and similar bridges |

## Frozen stable contracts (1.0.0)

- `sequrai.red-team.capability.descriptor`
- `sequrai.red-team.manifest`
- `sequrai.rt9.platform.payload`
- `sequrai.rt10.platform.payload`

Unknown JSON fields: **ignore** (consumers must forward-compatible parse).

Do not rename public types without adapters; prefer compatibility wrappers in team `integration/` packages.

See `docs/stabilization/contract-freeze-summary.md` for the stabilization snapshot.

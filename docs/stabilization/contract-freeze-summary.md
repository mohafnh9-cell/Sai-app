# Contract freeze summary

Registry: `server/ai-red-team/core/contracts/contract-registry.ts`  
Policy doc: `docs/architecture/contract-versioning.md`

## Stable (frozen at 1.0.0)

| Contract ID | Owner |
|-------------|-------|
| sequrai.red-team.capability.descriptor | rt-core |
| sequrai.red-team.manifest | rt-core |
| sequrai.rt9.platform.payload | rt9 |
| sequrai.rt10.platform.payload | rt10 |

## Internal

- sequrai.red-team.pipeline.result

## Compatibility

- sequrai.red-team.attack.finding (legacy AttackFinding consumers)

## Versioning rules

- Semver on each contract; breaking changes require major bump.
- Unknown JSON fields: ignore.
- No public renames without adapters.

## Validation

Stabilization tests assert stable contracts expose semver and `sequrai.*` ids.

Plugin authors must keep manifest `metadata.status` explicit when registering plugins.

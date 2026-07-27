# Replay safety

Core types: `core/replay/replay.types.ts`  
Validator: `core/replay/replay-safety-validator.ts`

## Rules

- Replay plans **must not** auto-execute (`metadata.executable === false`).
- Plans require finding reference, sequence steps, and expected evidence (warnings if missing).
- Statuses: `Valid`, `Valid with warnings`, `Blocked`, `Unsupported`, `Invalid`.

RT9/RT10 finding builders declare replay rules in manifests; team code generates non-executable plans for Mission Control / human replay workflows.

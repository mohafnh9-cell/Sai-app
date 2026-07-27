# Red Team testing

## Layers

| Layer | Location |
|-------|----------|
| Unit (core) | `server/ai-red-team/core/**/__tests__` |
| Stabilization | `server/ai-red-team/stabilization/__tests__` |
| RT9 | `business-logic/**/__tests__` |
| RT10 | `llm-team/**/__tests__` |
| Integration | `llm-team/integration/__tests__/`, director pipeline tests |

## Commands

```bash
npx vitest run server/ai-red-team          # full suite
npm run validate:red-team                  # manifest + stabilization gates
```

## Contract tests

Stabilization suite validates RT9/RT10 manifests against team capability registries and contract registry semver.

Expand cross-team contract snapshots as RT4/RT5/RT12/RT13 payloads evolve (golden tests in integration packages).

## Security-focused

- Tenant isolation: `business-logic/persistence/__tests__/persistence.test.ts`
- Runtime safety: stabilization runtime/replay tests
- Secret redaction: telemetry builder strips forbidden metadata keys

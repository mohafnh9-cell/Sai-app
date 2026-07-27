# Threat Modeling Framework

Location: `server/ai-red-team/threat-model/`

Foundation for RT11 — **modeling only** (no attacks, findings, or runtime execution).

## Dependency direction

```
RT11 (future)
  ↓
Threat Modeling Framework
  ↓
RT-Core contracts (assets, boundaries, preconditions, evidence, confidence)
```

RT-Core must not import `threat-model/` (enforced by tests).

## Entry point

```typescript
import { buildThreatModel } from "@/server/ai-red-team/threat-model";

const { model, validation, rejectedReason } = buildThreatModel({
  scope: { organizationId, projectId, scanId, executionId, correlationId },
  discovery: { ... },
  platform: { ... },
  rt9: { ... },
  rt10: { ... },
  intelligence: { ... },
});
```

Inputs must come from **persisted platform artifacts** (unified scan metadata, RT9/RT10 payloads, RT4 correlations). Models without discovery + team/platform evidence are rejected.

## Outputs

- `ThreatModel` (version `1.0.0`, contract `sequrai.threat-model`)
- Deterministic logical ids and chain fingerprints
- Attack cost, feasibility, priority (non-CVSS)
- Validation via `validateThreatModel`

## Capabilities

Registered through `registerThreatModelCapabilities()` — separate provider `rt11.threat-model.foundation`, no changes to RT-Core capability enums.

## Persistence

Contracts are persistence-ready; no DB migrations in this slice. Reference unified scan ids (`scanId`, `executionId`, `correlationId`).

See tests: `threat-model/__tests__/threat-model.test.ts`

# SequrAI — Contrato Único de Confidence

Este módulo es la **única fuente de verdad** para la confianza de un hallazgo.

## Taxonomía

| Nivel | Significado |
|---|---|
| `VERIFIED` | Evidencia runtime/sandbox confirma el hallazgo |
| `PROBABLE` | Evidencia estática fuerte + contexto correlacionado |
| `INFERRED` | Patrón/heurística sin explotabilidad directa |
| `SPECULATIVE` | Señal débil o LLM sin verificación estructural |

## Reglas

- Todo finding debe llevar exactamente uno de estos cuatro valores.
- El score numérico 0–1 vive solo dentro de `derive.ts` como input interno.
- `verificationStatus` y `confidenceLevel` son ejes distintos; ver `invariants.ts`.

## Uso

```ts
import { deriveConfidenceLevel, type ConfidenceLevel } from "@/brain/confidence";
```

Ningún otro módulo debe inventar su propio modelo de confidence.

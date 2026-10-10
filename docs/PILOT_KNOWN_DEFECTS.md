# Defectos conocidos del piloto (registro separado)

Cada uno con evidencia, estado y relación con el piloto. Ninguno se ha corregido salvo donde se indica una PR.

## D1 — Falso positivo `api.mass-assignment` en una aserción de prueba
- **Evidencia:** PR #68, commit `2ee901b`, scan `1ff00f24`: `app/api/oauth/consent/__tests__/route.test.ts:65`, `expect(body).toMatchObject({ organizationId: "org-sequrai", organizationName: "Sequrai" })`; regla `api.mass-assignment`, high, confianza medium. Es una aserción sobre la **respuesta**, no código que lea un cuerpo de **petición**.
- **No** se resuelve excluyendo los archivos de pruebas: `tests/security-benchmark/api/positive/index.ts:15` es un fixture vulnerable intencionado que debe seguir detectándose.
- **Arreglo propuesto:** distinguir aserciones sobre respuestas (`expect(...)`, variable `body` de una respuesta) de lecturas de entrada de petición, con casos positivos y negativos. Sin relación con la cobertura SQL.
- Estado: abierto; no bloquea.

## D2 — `introducedBlockers` inconsistente (1 frente a 22)
- **Evidencia:** mismo scan `1ff00f24` y mismo veredicto `725efa86`. Estado de GitHub (`finalize-webhook-scan.ts`): críticos+altos actuales − anteriores = 160 − 159 = **1**. Resumen del check run (veredicto guardado): `blockersCount` 181 − `previousBlockersCount` 159 (críticos+altos del scan anterior, `build-scan-verdict.ts`) = **22**. Unidades distintas (bloqueos totales frente a críticos+altos). El valor guardado ronda 21–22 sin cambios reales.
- **Arreglo propuesto:** una sola base y unidades (mismas severidades, misma rama) para ambos.
- Estado: abierto; no bloquea; no hay que atribuirlo a un falso positivo.

## D3 — Redirección de error a un callback no validado
- Corregido en #69 (abierta).

## D4 — `safe_fix` devolvía el estado capturado (`PROPOSED`) en lugar del persistido (`READY`)
- Corregido en #70 (abierta).

## D5 — `can_i_deploy` creaba alertas
- Corregido en #71 (abierta). La reparación de veredicto dentro de `resolveCanonicalDecisionState` (escritura al leer) sigue pendiente (mejora posterior).

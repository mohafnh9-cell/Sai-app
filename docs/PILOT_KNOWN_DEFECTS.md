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
- Corregido en #69, desplegado (`26b267b`), verificado en producción el 2026-10-10.

## D4 — `safe_fix` devolvía el estado capturado (`PROPOSED`) en lugar del persistido (`READY`)
- Corregido en #70, desplegado (`85dd084`). Verificación en producción de un `safe_fix` real: pendiente (requiere una sesión MCP nueva).

## D5 — `can_i_deploy` creaba alertas
- Corregido en #71, desplegado (`7a6c821`). La ejecución real del lote con el paso nuevo: pendiente de observar. La reparación de veredicto dentro de `resolveCanonicalDecisionState` (escritura al leer) sigue pendiente (mejora posterior).

## D6 — Textos en inglés en una interfaz en español (validación visual, 2026-10-10)
- **Causa (código en `main`):** las áreas del veredicto (`label`: "Security", "Authentication"…, y `methodologyNote`, "Score v1 is primarily driven by static security analysis…") se guardan como cadenas en inglés dentro del veredicto y `CoverageBreakdown.tsx` y `ProductionVerdictSurface.tsx` las muestran tal cual (`{area.label}`, `{verdict.methodologyNote}`), sin pasar por el catálogo i18n. Las limitaciones/metodología por área (`limitations`, `methodology`) también están en inglés.
- **Arreglo propuesto:** traducir por `area.key` y por una clave de metodología en la capa de presentación (no cambiar lo guardado). Estado: abierto; no bloquea.

## D7 — Qué significa "100" por área cuando la evidencia es limitada
- **Datos (`sequrai-e2e-test`, veredicto del commit `1eb0930`):** 8 áreas con `status: evaluated`, `score: 100`, `confidence: medium` y **`evidenceCount: 0`**; 4 áreas (`testing`, `performance`, `observability`, `reliability`) con `status: not_evaluated` y `score: null`. La confianza global del veredicto guardado es `low`.
- **Lectura correcta:** 100 = "ninguna regla estática produjo un hallazgo en esa área", no "se comprobó positivamente" (evidencia cero). Las áreas sin evaluar no tienen número (aparecen sin puntuación). `ProductionVerdictSurface.tsx` marca con ✓ verde toda área `evaluated` con puntuación ≥ 70 o nula, sin distinguir "sin hallazgos" de "evidencia positiva".
- **Puntuación global vacía:** por diseño, `shouldShowScore` oculta la puntuación cuando el estado es `insufficient_data` o `analysis_failed` (`brain/production-verdict/status-ui.ts`).
- **Arreglo propuesto:** mostrar `evidenceCount`/"sin hallazgos" junto al número, o no marcar ✓ cuando `evidenceCount = 0` y la confianza es baja. Estado: abierto; no bloquea; decisión de producto.

## D8 — Nomenclatura de pantallas
- No hay redirección al abrir `/projects/{id}/mission-control`: es la pantalla del proyecto; su migas de pan se llama **"Inteligencia de producción"** (`lib/navigation/breadcrumbs.ts`: `"mission-control": "productionIntelligence"`). "Centro de control" (barra lateral) es el panel de la organización (`/dashboard`, título de pestaña "Mission Control | SequrAI"). La única redirección interna es a la misma ruta con `?run=<id>` (aislamiento de análisis). Dos nombres para conceptos distintos; mejora posterior.

# Investigación: `manual_scan` frente a `automatic_review` sobre el commit `cd09ef6`

Alcance: solo registros existentes de producción (lecturas), código de `main` y historial git. **Sin nuevos scans.** Proyecto `sequrai-e2e-test`. Hecho = comprobado en registros/código; **hipótesis** = inferencia con evidencia circunstancial, pendiente de confirmar con logs.

## 1. Los dos escaneos no son equivalentes
| | `automatic_review` (`db96978f`) | `manual_scan` (`aa86a31e`, `bede780e`, `7c9b081a`) |
|---|---|---|
| Disparo | `trigger_type = webhook`, `review_type = automatic` | `trigger_type = manual`, `review_type = manual` |
| Archivos, reglas, versión | 13 archivos, 47 reglas, motor de análisis 2.0.0 | idénticos |
| Hallazgos nativos | 3 informativos (mismos archivos y reglas) | idénticos |
| Cobertura | 13 archivos, razón 1, mismas 4 áreas sin evaluar | idéntica |
| Motores externos | **ninguno** (0 `engine_executions`, 0 `security_jobs`) | opengrep 1.30.0, trivy 0.74.0, crypto 1.0.0, todos `COMPLETED`, 0 coincidencias |
| Pipeline de plataforma (Red Team estático + orquestación) | sin `platformExecution` | con `platformExecution`, decisión `SAFE_TO_DEPLOY`, confianza `unknown` |
| Veredicto | `ready_to_ship`, confianza media, 4 áreas sin evaluar | **`insufficient_data`**, confianza baja, mismas 4 áreas |
Conclusión de equivalencia: **no** lo son en evidencia planificada (la manual añade motores y pipeline de plataforma que la automática no ejecuta). Pero la manual, con más evidencia, produjo la decisión **menos** informada. Ninguna de las dos diferencias (motores presentes o no) figura hoy en el veredicto ni en la interfaz.

## 2. El veredicto manual se generó antes de que existiera su evidencia (hecho)
Línea temporal de `aa86a31e` (UTC, 2026-10-10): scan completado 07:12:53,8 → eventos `job_completed` **dos** (07:12:55,37 sin tipo de trabajo; 07:12:55,61 `manual_scan`) → motores solicitados 57,0 / 57,7 / 58,4 → **veredicto generado 07:12:57,79** → marcador de evidencia lista (`verdictEvidenceReadyAt`) 07:13:00,56 → motores terminan 07:13:01–07:13:07.
`bede780e` y `7c9b081a` repiten el patrón. El diseño documentado (`server/production-verdict/evidence-finalization.ts`) exige lo contrario: generar solo con marcador + todos los motores en estado terminal. Un veredicto es inmutable por scan, así que el resultado `insufficient_data` ("did not analyze enough") quedó fijado aunque los tres motores terminaron bien segundos después.

## 3. No es un caso aislado: cuándo ocurre (hecho, 22 escaneos con motores)
| Periodo | Veredicto respecto al último motor | Resultados |
|---|---|---|
| 4–5 oct (manual, 14 escaneos) | **después** (+0,9 a +1,4 s) | `ready_to_ship`/baja, `insufficient_data`/baja, `almost_ready`/baja… (los motores contaron) |
| 8–10 oct (manual, 8 escaneos) | **antes** (−4 a −10 s) en los 7 con marca temporal comparable; `3b8c0615` (9 oct) después | `ready_to_ship`/media ×3 (se calculó sin ver motores), `insufficient_data`/baja ×4 |
Mismo commit `21d48f2`, tres escaneos manuales → `ready_to_ship` y uno → `insufficient_data`: el resultado depende de la carrera, no del contenido.

## 4. Causa probable (hipótesis fuerte, no confirmada)
`getProductionReviewState` (`server/review-cancel/get-production-review-state.ts`) se ejecuta al sondear `GET /api/projects/{id}/active-production-review` y al renderizar la página Journey. Si encuentra un `scan_job` `running` cuyo `scan` ya está `completed`, lo trata como **huérfano** (`reconcileOrphanScanJobWithTerminalScan`, `server/jobs/reconcile-orphan-scan-job.ts`): marca el trabajo como completado y llama a `ensureProductionVerdictForCompletedScan(..., mode: "recovery")`, que **genera el veredicto con la evidencia que exista, sin esperar a los motores**. No exige antigüedad ni latido del trabajo.
Encaja con todos los hechos: (1) el scan pasa a `completed` varios segundos **antes** de que termine la etapa de plataforma y de que existan los motores, así que durante esa ventana un trabajo legítimo parece huérfano; (2) los escaneos manuales muestran un segundo evento `job_completed` sin tipo de trabajo (el del reconciliador) y el automático no (el reconciliador excluye `automatic_review`); (3) los afectados son los que se hicieron con la interfaz abierta (8–10 oct, comprobaciones visuales) y los no afectados, los del 4–5 oct; (4) el código del ejecutor y del finalizador **no cambió** entre ambos periodos (`git log`), y el *worker* de motores es el mismo (`claimed_by` idéntico).
**Por confirmar:** los registros de ejecución de la plataforma del 2026-10-10 07:12–07:17 (`orphan_detected` / `orphan_marked_completed`, componente `reconcile-orphan-scan-job`).

## 5. Qué debería pasar (criterio, sin forzar READY)
- Con las mismas condiciones, la misma decisión; si difieren (motores presentes o ausentes), la diferencia debe constar en el veredicto ("evidencia: nativa + opengrep + trivy + crypto" / "sin motores externos").
- Un trabajo en curso no se da por huérfano por leer su estado: exigir antigüedad o latido y, en recuperación, no fijar un veredicto mientras haya motores `QUEUED`/`RUNNING` salvo trabajo realmente abandonado.
- La decisión sobre si `automatic_review` debe ejecutar motores externos es **de producto**; mientras no los ejecute, la interfaz no debe presentar su resultado como equivalente al del análisis completo.
## 6. Siguientes pasos (no implementados)
1. Confirmar con logs (0,25–0,5 d). 2. Corregir el reconciliador con pruebas de carrera (1,5–3 d). 3. Hacer constar las fuentes de evidencia en el veredicto (0,5–1 d, tras decisión de producto). Hasta entonces, **las verificaciones en producción deben disparar el análisis por webhook** (push) y no por "analizar" manual con la interfaz abierta.

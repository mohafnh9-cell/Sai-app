# Evidencia — despliegue y E2E en producción (2026-10-09)

Todo lo que sigue se ejecutó realmente, salvo donde se indique. Recursos: base de datos de producción (migración 067, copia de seguridad), proyecto `sequrai-e2e-test` (repositorio desechable `mohafnh9-cell/sequrai-e2e-test`), organización Sequrai. No se tocó ningún otro proyecto ni organización.

## 1. Copia de seguridad y migración 067
- Copia lógica (CSV completo) de `safe_fix_records` (9), `safe_fix_lifecycle_events` (9), `safe_fix_verifications` (0), con suma de comprobación.
- **Restauración probada** en un PostgreSQL local de prueba: mismas filas y misma suma (`md5` del JSON ordenado, sesión UTC): `safe_fix_records` `abfed18c…`, eventos `b1ba78c7…`. Limitación: es una copia de las tablas afectadas, no un volcado completo; las copias automáticas de la plataforma no se pudieron comprobar desde aquí.
- 067 aplicada con `lock_timeout=5s` (fichero idéntico al de la PR #57; md5 `af6bfa95…`). Resultado: columna `proposal_commit_sha text NULL`, `CHECK` presente, **9/9 registros NULL**, y exportación de las columnas originales **idéntica byte a byte** a la copia.
- Después del E2E, los 9 registros anteriores siguen **idénticos byte a byte**.

## 2. Despliegue
- PR #57 fusionada 2026-10-09T10:45:37Z → `cebc2ab6…`; despliegue de Producción 6958799107, `success`, SHA = fusión = `origin/main`.
- PR #58 (docs) fusionada 10:54:28Z → `c8ada240…`.

## 3. Respuestas reales de PostgREST (clave anónima pública, sin filas afectadas)
| Petición | Respuesta |
|---|---|
| `select=proposal_commit_sha` (existe) | 200 `[]` |
| `select=<columna inexistente>` | 400 `{"code":"42703","message":"column safe_fix_records.… does not exist"}` |
| `PATCH` con columna inexistente | 400 `{"code":"PGRST204","message":"Could not find the '…' column of 'safe_fix_records' in the schema cache"}` |
| `PATCH` con `proposal_commit_sha` | 204 (RLS: 0 filas) |
El clasificador del código (`42703`, `PGRST204` o mensaje con `proposal_commit_sha`) cubre ambas.

## 4. Comprobaciones posteriores al despliegue
`GET …/safe-fixes` 200 con el registro antiguo (`READY`, `proposalCommitSha: null`, campo presente); `GET /api/brain/project/<id>` 200, `Cache-Control: private, no-store`; `mission-control` y `protection-center` 200.

## 5. E2E (commits en el repositorio de prueba; ninguna reescritura de historial)
| Commit | SHA | Análisis en la nube | Resultado |
|---|---|---|---|
| Base con bloqueo (V) | `cc250501…` | `4eedcb3b…` | `not_ready`, 1 bloqueo |
| Cambio que NO corrige (N) | `9f549247…` | `5aa67a70…` | `not_ready`, 1 bloqueo |
| Corrección (F) | `c395992f…` | `ddd71144…` | `ready_to_ship` (confianza media), 0 bloqueos |
| Reversión (R) | `792738a5…` | `ea53d588…` | árbol idéntico a la base original `21d48f2` |

Propuesta `69b2b7eb-c9ab-4ce0-9f39-c9a54d0b28ca` generada sobre el análisis de V (`reviewId` = `4eedcb3b…`), sin SHA (documental).

| Paso | Respuesta real |
|---|---|
| `applied` con `abc123` | 400 `Invalid request body` |
| `applied` con el commit base V | 409 `proposal_commit_is_base_commit` (estado sigue `APPROVED`) |
| `applied` con SHA sin análisis (`eee…`) → `verify` | `partial`, razones `verification_scan_missing, findings_unavailable`, `statement: not_verified` → `FAILED` |
| `reopen` desde `FAILED` / desde `READY` | 200 `READY` / 409 `invalid_transition:READY->READY` |
| `applied(N)` tras cambiar el SHA con la propuesta `APPROVED` | 409 `invalid_transition:READY->APPLIED` (la aprobación se invalida); tras `approve` → 200 `exact_proposal_commit` |
| `verify` de la propuesta ligada a N (existe ya un análisis limpio posterior de F) | `failed`, `target_still_present`, `verifiedCommit` = N, `verifiedScan` = `5aa67a70…`: **no** usa el análisis limpio de F |
| `applied(F)` + `verify` | `passed`, `binding: exact_proposal_commit`, `statement: exact_commit_rescan_clean`, `verifiedCommit` = F, `verifiedScan` = `ddd71144…`, `issueDisappeared: true` → `VERIFIED`, `proposalCommitSha` = F |
| `reopen` desde `VERIFIED` | 409 `invalid_transition:VERIFIED->READY` |
| Mismo `safeFixId` bajo otro proyecto de la organización (GET y POST) | 404 `Not found` |

Base de datos: 3 filas en `safe_fix_verifications` (`partial`, `failed`, `passed`), todas con `binding: exact_proposal_commit` y `baseCommitSha` = V; 19 eventos de ciclo de vida, incluidos los `proposal_commit_changed:…->…`.

## 6. Brain durante un análisis real (`GET /api/brain/project/<id>`, muestreo 0,6 s)
`0,0 s historical_review_in_progress` (reviewInProgress = análisis nuevo, currentVerdict = anterior, `readyForProduction:false`, `overall:null`) → `5,7 s pending_verdict` (sin veredicto) → `17,7 s current` (veredicto nuevo). Son peticiones en segundo plano: comprueban los campos de la API, **no** la interfaz.

## 7. Qué NO se verificó
- Aislamiento entre organizaciones en producción: no había una segunda sesión de otra organización de pruebas conectada; solo se verificó entre proyectos de la misma organización (404). Entre organizaciones: filtros probados en pruebas unitarias y RLS en PostgreSQL real, no en producción.
- Journey y sondeo con pestaña visible, y el brain en la interfaz: pendientes (runbook §5; requieren una persona).
- Registro documental sin SHA en producción (`later_analysis_clean_unbound`): solo pruebas unitarias; tras el E2E ya no quedan bloqueos para generar otra propuesta.
- Limitación SQL en el motor en la nube: pendiente (requiere un commit adicional de prueba, fuera de los tres autorizados).
- GitHub App e instalación del cliente: pendiente de coordinar con el cliente.


---

# Lote 2 (2026-10-09, tarde) — migración 068, despliegue de #60/#62/#61 y pruebas de repetición/concurrencia

## Copia de seguridad y migración 068
- Copia de `safe_fix_records` (10), `safe_fix_lifecycle_events` (28), `safe_fix_verifications` (3) y **restauración probada** en un PostgreSQL local (mismos recuentos y mismo `md5` del JSON ordenado, sesión UTC). La copia de la tabla contiene necesariamente filas del proyecto protegido; solo se leyeron y quedan en una carpeta local privada.
- Comprobación de duplicados antes de aplicar: **0** pares (proyecto, recomendación) con más de un registro abierto (7 `READY`, 2 `SUPERSEDED`, 1 `VERIFIED`).
- Alcance del índice: único y parcial sobre `(project_id, recommendation_id)` para `PROPOSED/READY/APPROVED/APPLIED/VERIFYING`; los terminales pueden repetirse. Los identificadores (`priority-1-web`, …) son posicionales y se repiten entre análisis; el índice los trata como **una clave por proyecto** (un segundo análisis con la corrección anterior en curso recibe `in_flight`). No distingue ramas (limitación conocida).
- Ensayo del archivo exacto (`md5 cd5cda1a…`) sobre la copia restaurada: índice creado. Aplicada en producción con `lock_timeout=5s`: índice `uq_safe_fix_one_open_per_recommendation` presente; los 10 registros **idénticos byte a byte**.

## Fusiones y despliegues
| PR | Fusión | Despliegue (Producción) |
|---|---|---|
| #60 | `dba5f9fa` 12:06:03Z | 6960242908 `success` |
| #62 | `448bc516` (rama actualizada contra `main` tras #60; conflictos de `add/add` resueltos conservando la versión de #62; diff final = solo los cambios de #62; CI verde) | — |
| #61 | `0a076ed7` (rama actualizada; diff = sus 16 archivos; CI verde) | 6960499262 `success`, SHA = `main` |
Despliegue estable anterior para recuperación: 6958950455 (`c8ada24`).

## Pruebas en `sequrai-e2e-test` (4 commits: fixture → solo docs → arreglo → restauración; árbol final = base original)
| Prueba | Resultado real |
|---|---|
| 409 sobre el registro `VERIFIED` existente: `verify`, acción por defecto, `approve`, `reopen`, `applied` con y sin SHA | **6 × 409** `invalid_transition:VERIFIED->…`; estado, SHA y `updatedAt` idénticos antes y después |
| 5 creaciones simultáneas sobre una clave nueva | 5 × 200, **un único id** (1 creada + 4 `reused`); BD: **1** registro abierto |
| Repetición con el registro `READY` / tras `approve` / repetir | mismo id, `reused:true`; **estado `APPROVED` preservado**; sin eventos nuevos |
| Commit solo de documentación (análisis base nuevo) con el registro `APPROVED`: 1 + 5 simultáneas | **409 `in_flight`** (`different_base_analysis`) en las 6; registro `APPROVED` conservado, `reviewId` anterior |
| `applied(F2)` → `verify` (arreglo real) | `passed`, `exact_commit_rescan_clean`, `VERIFIED`, SHA y análisis de F2 |
| BD tras las pruebas | 0 pares con >1 abierto; **0** eventos `SUPERSEDED` desde `APPROVED/APPLIED/VERIFYING`; los 10 registros anteriores idénticos byte a byte |
No se observó si algún `INSERT` concurrente chocó con el índice (el resultado es el esperado, el camino `23505` no se vio directamente).

## Sigue sin verificarse
Recorrido con agente MCP real (sin credencial); aislamiento con sesión B; Journey, polling visible y dashboard/proyectos en la interfaz durante un análisis; limitación SQL en el motor cloud; instalación del cliente.

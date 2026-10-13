# Checklist de aceptación de SequrAI V1 (única)

Una sola lista para decidir V1. **No duplica** las listas del piloto: las referencia y las reemplaza como criterio de entrega de V1.
Estados: **pendiente · en curso · bloqueado · verificado**. Ningún punto está **verificado**: ninguno tiene aún evidencia completa de recorrido de usuario en producción con todas sus condiciones; "en curso" indica que hay evidencia parcial concreta. Existencia de código o de una PR no cuenta como verificación. Fecha de referencia: 2026-10-13, `main` = producción = `3ea5dab`.
Estimaciones: rangos en días de trabajo restantes de una persona [E]; no incluyen esperas de terceros.

## Relación con las checklists existentes (no se copian)
- `PILOT_SPRINT_CHECKLIST.md` (A/B) y `PILOT_DECISION_CHECKLIST.md` (K1–K4, mejoras) están en la PR #65 (abierta): K1 → puntos 6 y 7; K2 → 12; K3 → 8 y 10; K4 → 16 y 19. Cuando #65 se fusione, esas listas pasan a ser evidencia de esta; no se mantienen dos estados.
- `PILOT_KNOWN_DEFECTS.md` (D1–D8) alimenta el punto 16. `PILOT_CLAUDE_CODE_OAUTH_TEST.md` es la evidencia de los puntos 8 y 13. `RED_TEAM_AUDIT_2026-10-13.md` es la evidencia del 15.
- Evidencia anterior que sigue siendo válida mientras no cambie el código afectado: 067/068 (migraciones), verificación de SHA exacto (A3), OAuth con Claude Code. **Exigen repetirse:** cualquier cambio en `safe-fix-engine/verify`, `lifecycle`, las rutas OAuth o el flujo de consentimiento; el despliegue de #74 (puntos 15, 8, 9); cualquier cambio de la GitHub App.

## Lista

### 1. Alcance de V1 cerrado
- **Estado:** en curso
- **Evidencia:** Definición del propietario (2026-10-13): análisis cloud, MCP, corrección asistida y verificación de commit exacto, aislamiento/permisos/recuperación, onboarding sin consola, límites documentados. Fuera: Red Team dinámico y correcciones autónomas. Este documento + `ROADMAP_…` reenfocado; restricción en servidor en #74 (abierta).
- **Entorno y fecha de verificación:** docs, 2026-10-13
- **Dependencias:** Aprobación del propietario; fusionar #73/#74 · **Responsable:** propietario / agente
- **Estimación restante:** 0,5–1 d (documentación)
- **Bloquea V1:** sí

### 2. Conexión GitHub
- **Estado:** en curso
- **Evidencia:** Conexión de `sequrai-e2e-test` por GitHub App y flujo completo verificados en producción (`PILOT_E2E_EVIDENCE_2026-10-09.md`); corrección de falso negativo de instalación inactiva (`637f47a`). **Sin verificar en real:** instalación revocada y repositorio desconectado (solo pruebas locales); permisos mínimos de la App del cliente (B1–B8).
- **Entorno y fecha de verificación:** producción (repo propio), 2026-10-09
- **Dependencias:** Instalación revocada/desconectada: provocarla en un repo de prueba; B1–B8 con el cliente · **Responsable:** agente + propietario
- **Estimación restante:** 1–3 d (verificación 1–2; desarrollo solo si aparece un defecto)
- **Bloquea V1:** sí

### 3. Identidad del análisis
- **Estado:** en curso
- **Evidencia:** Verificación ligada al SHA exacto y rechazo de commit sin corrección con análisis limpio posterior: producción 2026-10-09 (`PILOT_E2E_EVIDENCE`, A3). Migración 067 (`proposal_commit_sha`). Pendiente: comprobar organización/proyecto/repositorio/rama de forma explícita en resultados, historial, MCP y verificación con un caso de otra rama y de otro proyecto reales; pruebas locales ya existen (`safe-fix-isolation`, `safe-fix-commit-binding`).
- **Entorno y fecha de verificación:** producción parcial; local completo, 2026-10-09
- **Dependencias:** Repo de prueba con 2 ramas · **Responsable:** agente
- **Estimación restante:** 1–2 d (verificación)
- **Bloquea V1:** sí

### 4. Ejecución fiable
- **Estado:** pendiente
- **Evidencia:** Estados y recuperación existen en código (`security-jobs/state-machine`, `scan-job-recovery`, `review-cancel`) con pruebas unitarias; **no se han observado en producción** cancelación, fallo, reintento ni recuperación tras caída. Hay una prueba de latencia intermitente preexistente (`worker-run-job.perf.bench`). **Hallazgo (registros existentes, `INVESTIGATION_MANUAL_VS_AUTOMATIC_VERDICT_2026-10-13.md`):** en 7 de 8 escaneos manuales del 8–10 oct el veredicto se generó **antes** de que terminaran los motores externos y quedó fijado (3 `ready_to_ship`/media sin ver motores, 4 `insufficient_data`), mientras que los del 4–5 oct esperaron a los motores. Mismo commit `cd09ef6`: el `automatic_review` (sin motores externos) dio `ready_to_ship`/media; los 3 manuales, `insufficient_data`. Causa probable (hipótesis fuerte, sin confirmar con logs): `getProductionReviewState` (sondeo de la interfaz y página Journey) trata como huérfano un trabajo aún en curso cuyo scan ya está `completed` y fija el veredicto en modo `recovery`. Hasta corregirlo, las verificaciones reales deben dispararse por webhook (push).
- **Entorno y fecha de verificación:** local
- **Dependencias:** Casos reales: cancelar, forzar fallo, reintento sin duplicar · **Responsable:** agente
- **Estimación restante:** 3–6 d (verificación 2–3; investigación de `manual_scan` 1–2; contingencia de desarrollo 0–1)
- **Bloquea V1:** sí

### 5. Veredictos respaldados
- **Estado:** en curso
- **Evidencia:** Puerta canónica `deploymentPostureOf` (alta confianza + cobertura completa) usada por MCP, check de GitHub y UI; MCP real devolvió `MORE_ANALYSIS_REQUIRED` con 100/100 (2026-10-09); capturas del propietario confirman lenguaje conservador (2026-10-10). Abierto: D7 (el "100" por área con `evidenceCount 0` se pinta con ✓ verde) y D2 (`introducedBlockers` 1 frente a 22).
- **Entorno y fecha de verificación:** producción, 2026-10-09/10
- **Dependencias:** Decisión de producto sobre D7; corregir D2 · **Responsable:** agente + propietario
- **Estimación restante:** 1–3 d (D7 decisión + cambio pequeño 0,5–1; D2 1–2)
- **Bloquea V1:** sí (D7 se decide; D2 se clasifica en el punto 16)

### 6. Interfaz coherente
- **Estado:** en curso
- **Evidencia:** #72 desplegada (`3ea5dab`): sin puntuaciones de relleno, tendencia sobre veredictos con evidencia, hitos con fecha/commit/histórico. **Pendiente repetir la comprobación visual** de Journey (puntuaciones "—", tendencia estable, hitos), dashboard/proyectos y D6 (textos en inglés), D8 (nombres de pantalla).
- **Entorno y fecha de verificación:** producción; visual pendiente
- **Dependencias:** Propietario ejecuta V1 (Journey) y dashboard/proyectos · **Responsable:** propietario + agente
- **Estimación restante:** 1,5–3 d (comprobación visual 0,5–1; traducciones D6 1–2)
- **Bloquea V1:** sí

### 7. Actualización de estados
- **Estado:** pendiente
- **Evidencia:** Código: sondeo cada 4 s solo en Mission Control del proyecto mientras haya revisión en curso, pruebas de seguridad o veredicto materializándose; Journey, dashboard y Proyectos no sondean (servidor). **Sin observación real.** Requiere un commit documental autorizado en `sequrai-e2e-test` y que el propietario tenga las páginas abiertas; restauración con un segundo commit (no autorizado aún).
- **Entorno y fecha de verificación:** —
- **Dependencias:** Autorización de los commits; propietario preparado · **Responsable:** propietario + agente
- **Estimación restante:** 0,5–1 d (verificación)
- **Bloquea V1:** sí

### 8. MCP real
- **Estado:** en curso
- **Evidencia:** Claude Code real, OAuth, 3 ámbitos, 4 rechazos y herramientas permitidas con datos reales, retirada con rechazo observado del acceso: 2026-10-09 (`PILOT_CLAUDE_CODE_OAUTH_TEST.md`). **Protocolo simulado, no real:** refresco y rechazo del refresco (#66, DB/código). Pendiente: renovación real, y un entorno del cliente declarado compatible (A16).
- **Entorno y fecha de verificación:** producción (Claude Code), 2026-10-09
- **Dependencias:** Esperar caducidad del acceso (1 h) en una sesión real; decisión del entorno del cliente · **Responsable:** agente + propietario
- **Estimación restante:** 0,5–1,5 d (verificación)
- **Bloquea V1:** sí

### 9. Safe Fix consistente
- **Estado:** en curso
- **Evidencia:** Idempotencia/concurrencia (#62) probada en PostgreSQL real y en producción (2026-10-09); correcciones en curso conservadas. #70 (estado persistido) desplegada `7a6c821`: pruebas locales verdes, **sin repetir un `safe_fix` real tras el despliegue** (necesita sesión MCP nueva).
- **Entorno y fecha de verificación:** producción 2026-10-09; local
- **Dependencias:** Sesión MCP nueva (reautorizar cliente) · **Responsable:** agente + propietario
- **Estimación restante:** 0,5 d (verificación)
- **Bloquea V1:** sí

### 10. Verificación exacta
- **Estado:** en curso
- **Evidencia:** Rescan del SHA exacto y `exact_commit_rescan_clean` verificados en producción dos veces (2026-10-09); 409 controlados; `reopen`. Pendiente: demostrar en real el rechazo por otro proyecto/organización/repositorio/rama y que un cambio de propuesta invalida la aprobación (hay pruebas locales: `PROPOSAL_CHANGED_REASON` en `safe-fix-engine/lifecycle`).
- **Entorno y fecha de verificación:** producción parcial
- **Dependencias:** Casos reales con segunda rama/proyecto · **Responsable:** agente
- **Estimación restante:** 1–2 d (verificación)
- **Bloquea V1:** sí

### 11. Flujo asistido utilizable
- **Estado:** en curso
- **Evidencia:** **No existe superficie de producto**: la UI solo copia el prompt; aprobar/aplicado/verificar existen solo como API (`/api/projects/{id}/safe-fixes/{id}`), por eso las pruebas se hicieron con la consola del navegador. Panel "Corrección asistida" en la página del proyecto: especificación `V1_ASSISTED_FIX_PANEL_SPEC.md`, **implementado en la PR #75 (abierta, sin fusionar ni desplegar)** con 62 pruebas locales (recorrido completo sobre el motor real en memoria). Falta: CI de la PR, despliegue y aceptación real sin consola (criterio 13 de la especificación; requiere commits autorizados en `sequrai-e2e-test`).
- **Entorno y fecha de verificación:** —
- **Dependencias:** Diseño aprobado; #70 desplegada · **Responsable:** agente
- **Estimación restante:** 1–2 d (revisión/CI de #75 0,5–1; aceptación real 0,5–1)
- **Bloquea V1:** **sí**

### 12. Aislamiento entre clientes
- **Estado:** pendiente
- **Evidencia:** Pruebas locales y PostgreSQL (067/068) y 404 entre proyectos de la misma organización en producción. **Falta la sesión B** (usuario real de otra organización no protegida): lectura y escritura sobre proyecto, propuesta Safe Fix, resultados, historial, API MCP.
- **Entorno y fecha de verificación:** producción pendiente
- **Dependencias:** Acción B1 del propietario (cuenta en ventana privada) · **Responsable:** propietario + agente
- **Estimación restante:** 0,5–1 d (verificación)
- **Bloquea V1:** **sí**

### 13. OAuth seguro
- **Estado:** en curso
- **Evidencia:** Consentimiento que decide los ámbitos (#63), workspace visible (#68), callbacks validados y errores locales (#69, verificado en producción 2026-10-10), cliente retirado → `invalid_client`. Ausencia de credenciales en logs: prueba de protocolo (#66); **sin revisión de logs reales**.
- **Entorno y fecha de verificación:** producción 2026-10-10
- **Dependencias:** Revisar logs de Vercel de una conexión (sin exponer tokens) · **Responsable:** agente
- **Estimación restante:** 0,5–1 d (verificación)
- **Bloquea V1:** sí

### 14. Alertas
- **Estado:** en curso
- **Evidencia:** #71 desplegada: `can_i_deploy` no crea alertas; evaluación en el lote diario (función registrada; cron `30 7 * * *`). **Ejecución del paso nuevo no observada.** Deduplicación y canal in-app documentados en el código; correo solo para críticas.
- **Entorno y fecha de verificación:** producción 2026-10-10 (registro); ejecución sin observar
- **Dependencias:** Ver el historial de Inngest (`evaluate-deploy-decision`) · **Responsable:** propietario
- **Estimación restante:** 0,25–0,5 d (verificación)
- **Bloquea V1:** no (informar si falla)

### 15. Red Team fuera de V1
- **Estado:** en curso
- **Evidencia:** Auditoría `RED_TEAM_AUDIT_2026-10-13.md`: campañas dinámicas e hipótesis enlatada eran alcanzables por API, UI y MCP. #74 fusionada y desplegada (`5fe87e6`). **Observado en producción 2026-10-13** (sesión del propietario, peticiones mínimas): `POST attack-campaigns`, `POST attack-authorizations` y `POST dynamic-target-authorization` (`status`) → **403 `DYNAMIC_TESTING_UNAVAILABLE`**; recuentos de campañas, ejecuciones, autorizaciones y verificaciones del proyecto `sequrai-e2e-test` sin cambios (0/0/0/0); el destino de la autorización de prueba era `example.invalid`, y el 403 se produce antes de cualquier acción. El 403 con ese código implica que la flag `attack_simulation` está abierta para la organización Sequrai en producción (override o lista interna); el cierre de servidor funciona igualmente. **No observado:** `authorize_dynamic_target` por MCP en producción (sin sesión MCP), ni la ausencia de la pestaña Attack Center en una organización no interna. Hecho adicional: en toda la base hay 62 campañas, 234 ejecuciones, 7 autorizaciones y 8 verificaciones históricas (agregados; no inspeccionadas, organizaciones protegidas).
- **Entorno y fecha de verificación:** producción `5fe87e6`, 2026-10-13 (rutas); MCP y UI de otra organización sin observar
- **Dependencias:** Sesión MCP nueva (reautorizar cliente) para el rechazo del MCP; una cuenta no interna (sesión B) para la UI
- **Estimación restante:** 0,25–0,5 d (verificar MCP en producción)
- **Bloquea V1:** **sí**

### 16. Cobertura y defectos conocidos
- **Estado:** en curso
- **Evidencia:** `PILOT_KNOWN_DEFECTS.md` (D1–D8), límite SQL (`known-gap-sql-concatenation.test.ts`). Falta: documento de cobertura (lenguajes, motores — opengrep/trivy/scorecard/cripto/Red Team estático —, exclusiones, tamaño máximo de archivo 256 KB/200 archivos del Red Team estático) y clasificar cada defecto por impacto en V1.
- **Entorno y fecha de verificación:** docs
- **Dependencias:** — · **Responsable:** agente
- **Estimación restante:** 1,5–2,5 d (documentación)
- **Bloquea V1:** sí

### 17. Calidad de entrega
- **Estado:** en curso
- **Evidencia:** Última ejecución completa (2026-10-13): 3629 tests pasan; 2 fallos preexistentes `api-routes-auth-audit` (autoanálisis, puntuación 79 < 100); `tsc` 107 errores preexistentes (la mayoría en archivos de pruebas); eslint 0 errores; build correcto en las PR. **Sin triaje de los 107 errores por si afectan al recorrido de V1.**
- **Entorno y fecha de verificación:** local/CI, 2026-10-13
- **Dependencias:** — · **Responsable:** agente
- **Estimación restante:** 1,5–2,5 d (triaje)
- **Bloquea V1:** sí (triaje); los errores no relacionados no bloquean

### 18. Operación y recuperación
- **Estado:** en curso
- **Evidencia:** Migraciones 067/068 ensayadas en PostgreSQL real y aplicadas con copia y restauración verificadas (2026-10-09). Despliegue de recuperación identificado pero **nunca ejecutado**; limpieza de datos de prueba (propuestas, tokens retirados, repositorios desechables) pendiente; logs redactados sin revisión sistemática.
- **Entorno y fecha de verificación:** producción 2026-10-09 (migraciones)
- **Dependencias:** Ensayo de redespliegue a un SHA anterior (con autorización) · **Responsable:** agente + propietario
- **Estimación restante:** 2–3,5 d (ensayo + limpieza)
- **Bloquea V1:** sí

### 19. Onboarding completo
- **Estado:** en curso
- **Evidencia:** Borradores `PILOT_ONBOARDING_2026-10-12.md` y `PILOT_RUNBOOK_2026-10-12.md`. Faltan: pasos sin consola (depende del punto 11), responsable de soporte y **procedimiento de revocación** (hoy no hay pantalla: la retirada de tokens fue una escritura en base de datos).
- **Entorno y fecha de verificación:** docs
- **Dependencias:** Punto 11; decisión sobre revocación (pantalla mínima o procedimiento operativo) · **Responsable:** agente + propietario
- **Estimación restante:** 2,5–4 d (documentación; +2–3 d solo si se decide una pantalla de revocación)
- **Bloquea V1:** sí

### 20. Aceptación final
- **Estado:** pendiente
- **Evidencia:** Demostración completa sobre un repositorio autorizado usando solo las superficies del usuario, SHA desplegado, evidencia y limitaciones aceptadas, y decisión explícita listo/no listo.
- **Entorno y fecha de verificación:** —
- **Dependencias:** Todos los bloqueantes anteriores · **Responsable:** propietario + agente
- **Estimación restante:** 1–1,5 d
- **Bloquea V1:** sí

## Flujo asistido mínimo que sustituye los pasos manuales (punto 11)
**Hoy:** crear la propuesta (`safe_fix` por MCP) y aprobar / informar el commit / verificar solo existen como API (`POST /api/projects/{id}/safe-fixes/{safeFixId}` con `approve | applied + commitSha | verify | reopen`); en las pruebas se ejecutaron desde la consola del navegador. La interfaz (`CopySafeFixPromptButton`, `SafeFixHeroCard`) solo copia el prompt: ninguna pantalla llama a esas rutas [H].
**Mínimo, sin backend nuevo y sin automatizar parches:** un panel "Corrección asistida" en la página del proyecto (Inteligencia de producción) que use las rutas existentes:
1. Lista y estado de las propuestas del proyecto (`GET …/safe-fixes`), mostrando el estado **persistido** (#70) y el análisis base.
2. **Aprobar** → **Informar el commit** (SHA completo de 40 caracteres, prellenado con el último commit detectado de la rama por defecto, editable y validado) → **Verificar** → resultado explícito: `exact_commit_rescan_clean` ("corregido en ese commit"), `not_verified` ("no verificado") o `later_analysis_clean_unbound` ("hay un análisis posterior limpio, pero no ligado a tu commit").
3. Errores 409/404/503 de `mapSafeFixError` con la acción de recuperación (reabrir, esperar el análisis, elegir otro commit) en español e inglés.
4. Pruebas de componente y un recorrido local completo (laboratorio de propuesta → aprobación → commit → verificación); documentación de usuario.
No incluye: generar parches, abrir PR, escribir en GitHub, cola de trabajos nueva ni nuevos ámbitos MCP. Estimación [E]: **4–8 días**. Alternativa menos recomendable: herramientas MCP `safe_fix_approve/applied/verify` (nuevos ámbitos y consentimiento; más superficie).

## Orden mínimo para cerrar V1 y estimación
Camino crítico (cada paso habilita el siguiente):
1. **Cerrar el alcance**: #74 (Red Team cerrado en servidor) **fusionada, desplegada (`5fe87e6`) y observada en tres rutas** el 2026-10-13; resta la comprobación por MCP (sesión nueva) — ≤ 0,5 d (puntos 1, 15).
2. **Flujo asistido de producto** (punto 11): implementado en #75; falta revisión, despliegue y aceptación real (1–2 d). **Corregir D9 antes de las verificaciones reales con análisis manual.** En paralelo, el propietario ejecuta los pendientes que no dependen de código: Journey/dashboard/proyectos (6), sesión B (12), observación de estados con commit documental (7), esperas de renovación OAuth (8).
3. **Verificaciones reales posteriores al flujo**: Safe Fix tras #70, verificación exacta con rechazos reales (9, 10), identidad con segunda rama/proyecto (3), instalación revocada/desconectada (2) — 5–10 d.
4. **Fiabilidad y operación**: ejecución fiable con cancelación/fallo/reintento reales (4), ensayo de recuperación y limpieza (18), logs y OAuth (13), alertas observadas (14) — 6–12 d.
5. **Documentación y calidad**: cobertura y defectos por impacto (16), triaje de typecheck/pruebas (17), onboarding con revocación (19) — 7–11 d.
6. **Aceptación final** sobre un repositorio autorizado, con decisión explícita (20) — 1–2 d.

## Estimación revisada (2026-10-13): esfuerzo, dependencias y calendario por separado
**Esfuerzo restante [E]**, desglosado y reutilizando lo ya hecho (el panel ya está implementado en #75; la documentación del piloto y la evidencia válida se reutilizan):
| Categoría | Contenido | Días |
|---|---|---|
| Desarrollo | Panel: revisión/CI de #75 (0,5–1) · **corrección del reconciliador de veredictos** (D9, con pruebas de carrera) (1,5–3) · D7/D6/D2 (2–5) · contingencia por defectos hallados en las comprobaciones (2–5) | **6–14** |
| Observación / verificación (sin código salvo defecto) | 2 (1–2) · 3 (1–2) · 4, casos reales de cancelar/fallar/reintentar (2–3) · 7 (0,5–1) · 8 (0,5–1,5) · 9 (0,25–0,5) · 10 (1–2) · 11, aceptación real (0,5–1) · 12 (0,5–1) · 13 (0,5–1) · 14 (0,25–0,5) · 15 (0,25–0,5) · 18, ensayo de recuperación (1–2) | **8–17** |
| Documentación (reutiliza `PILOT_ONBOARDING`, `PILOT_RUNBOOK`, `PILOT_KNOWN_DEFECTS`, `MCP_OAUTH`) | 1 (0,25–0,5) · 16, cobertura (1–2) · 19, onboarding con panel y revocación (1,5–2,5) · 20 (0,5–1) | **3,25–6** |
| Triaje de calidad | 17: 107 errores de `tsc`, 2 fallos preexistentes y la prueba intermitente (1,5–2,5) | **1,5–2,5** |
| Confirmaciones | causa de D9 con logs (0,25–0,5) | **0,25–0,5** |
| **Total** | | **≈ 19–40 días de trabajo** |
La documentación pasa de 8–14 d a 3,25–6 d porque el onboarding, el runbook, los defectos y el OAuth ya están escritos y solo se actualizan; lo que antes se contaba como documentación y es comprobación (ensayo de recuperación, aceptación real) está ahora en observación. No se suman como desarrollo completo las capacidades que solo requieren comprobar (2, 3, 7–10, 12–15, 18), ni se marca como verificado nada que no se haya observado.

**Dependencias (no suman esfuerzo):**
- **D9 antes de las verificaciones reales con análisis manual** (puntos 3, 4, 5, 9, 10): mientras exista, un "analizar" manual con la interfaz abierta puede fijar `insufficient_data`; hasta corregirlo, se dispara por push (webhook).
- #75 desplegada antes de la aceptación sin consola (11); commits autorizados en `sequrai-e2e-test` para esa aceptación y para el sondeo (7).
- Sesión B (12) y comprobaciones visuales (6): acciones del propietario.
- Reautorizar el cliente OAuth y la caducidad de 1 h del acceso (8, 9, 15); logs de ejecución para confirmar D9 y el lote diario (14); B1–B8 y el entorno del cliente (2, A16).

**Calendario [E]** (una persona de desarrollo y el propietario disponible para sus acciones):
| Semana | Foco |
|---|---|
| 13–19 oct | Revisión y CI de #75; corrección de D9; comprobaciones visuales y sesión B |
| 20–26 oct | Despliegue de #75 y D9; aceptación sin consola; observación de estados; verificaciones 3, 9, 10 |
| 27 oct–2 nov | Ejecución fiable real (4), OAuth/alertas (8, 13, 14), D7/D6/D2 |
| 3–9 nov | Instalación revocada/desconectada (2), recuperación (18), documentación (16, 19) |
| 10–16 nov | Triaje de calidad (17), contingencias, demostración final (20) y decisión |
**Resultado:** candidato a V1 entre **mediados y finales de noviembre**, con el margen del ciclo (hasta el 13 de enero). Si las comprobaciones destapan defectos, lo que se mueve es la fecha.

## Mediciones de fluidez (nuevas; no sustituyen a ningún punto)
Objetivo: saber dónde se pierde tiempo antes de optimizar. **Solo se optimiza un cuello de botella medido, conservando cobertura y controles** (ningún motor se omite ni se reduce el análisis por velocidad).
| Medida | Fuente | Base observada (datos existentes, 16 escaneos de `sequrai-e2e-test`, repo de 13–14 archivos, 2026-10-09/10) | Estado |
|---|---|---|---|
| Espera en cola (creación → inicio) | `scans.created_at → started_at`; `scan_job_events.queue_wait_ms` | 4,2–14,0 s, mediana 5,6 s (`queue_wait_ms` ≈ 1,9–2,4 s en los eventos de trabajo) | observada |
| Ejecución del análisis (inicio → completado) | `scans.started_at → completed_at` | 1,6–2,5 s, mediana ≈ 1,9 s | observada |
| Motores | `engine_executions.duration_ms` (6 escaneos) | opengrep media 1,0 s (máx. 1,2); trivy media 2,2 s (máx. 5,7); crypto ≈ 0 s | observada |
| Veredicto final (completado → veredicto) | `scans.completed_at → production_verdicts.generated_at` | 2,9–10,8 s, mediana 3,75 s | observada |
| Total (creación → veredicto) | ídem | 9,2–24,5 s, mediana 11,6 s | observada |
| Tiempo de respuesta de la interfaz — **navegación completa** (carga de documento, 3 cargas por página) | Navigation Timing en la pestaña Chrome del propietario, solo lectura | `dashboard`: DCL 5,75 / 2,29 / 2,92 s; `proyectos`: 1,81 / 2,72 / 1,83 s; `journey`: 2,79 / 4,36 / 2,74 s; `mission-control` (con redirección a `?run=`): 5,90 / 6,05 / 6,05 s. TTFB del documento 27–113 ms en todos | observada (12 muestras) |
| Tiempo de respuesta de la interfaz — **navegación interna** (clic en la barra lateral, dashboard ↔ proyectos, 6 saltos) | mutaciones del DOM tras el clic | contenido estable 0,34–0,39 s en 5 saltos y 0,96 s en 1; el cambio de URL no es medible (granularidad de 1 s por temporizador) | observada (6 muestras) |
| Repositorios de tamaño real | mismas fuentes con un repositorio mayor | — | **sin medir**; no extrapolar de 13 archivos |
Límites: repositorio mínimo; los tiempos de motores externos (opengrep/trivy) crecerán con el tamaño; la ruta `manual_scan` muestra 14,0 s de espera en 1 de 16 casos (valor atípico, causa desconocida). Umbrales objetivo: **por acordar** tras medir un repositorio realista.
**Cómo leer las muestras de interfaz:** son **12 cargas completas y 6 saltos internos** en una sola sesión, un solo usuario y una sola máquina, con la pestaña de automatización **oculta** (`document.hidden = true`, lo que puede inflar tiempos y fija a 1 s los temporizadores). El LCP no estuvo disponible. **No representan el rendimiento de clientes.** Observación útil: Mission Control tarda ~2–3 veces más que las otras páginas y pasa por una redirección adicional a `?run=<id>`; es el candidato a medir con más cuidado antes de optimizar. Pendiente (sin ejecutar): repetir con una pestaña visible y un repositorio mediano desechable propiedad de SequrAI.

## Decisión actual
**V1 no está listo.** Bloqueos concretos: 11 (el panel existe en #75, sin desplegar ni aceptar sin consola), 12 (sesión B), 15 (restricción de Red Team desplegada y observada en tres rutas; falta MCP y UI de otra organización), 6/7 (verificación visual y de estados sin hacer), 4 (ejecución fiable sin observar y defecto D9 del reconciliador, que fija veredictos antes de tiempo), 18/19/20 (recuperación, onboarding y demostración final). Esta lista no se marca como verificada hasta que cada punto cumpla su evidencia; la decisión se repite al cerrar cada bloque.

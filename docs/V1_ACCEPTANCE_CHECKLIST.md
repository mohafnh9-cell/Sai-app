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
- **Evidencia:** Estados y recuperación existen en código (`security-jobs/state-machine`, `scan-job-recovery`, `review-cancel`) con pruebas unitarias; **no se han observado en producción** cancelación, fallo, reintento ni recuperación tras caída. Hay una prueba de latencia intermitente preexistente (`worker-run-job.perf.bench`). **Hallazgo nuevo (datos existentes, 2026-10-10):** tres escaneos `manual_scan` sobre el commit `cd09ef6` (13 archivos, motores opengrep/trivy/crypto `COMPLETED`, cobertura 1) terminaron en `insufficient_data` ("did not analyze enough"), mientras que el `automatic_review` del mismo commit (`db96978f`) dio `ready_to_ship` con confianza media. La ruta manual y la automática no producen el mismo veredicto para el mismo commit: hay que explicar la diferencia antes de V1 (puntos 4 y 5).
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
- **Estado:** pendiente
- **Evidencia:** **No existe superficie de producto**: la UI solo copia el prompt; aprobar/aplicado/verificar existen solo como API (`/api/projects/{id}/safe-fixes/{id}`), por eso las pruebas se hicieron con la consola del navegador. Mínimo: panel "Corrección asistida" en la página del proyecto; recorrido y criterios de aceptación en `V1_ASSISTED_FIX_PANEL_SPEC.md` (sin implementar).
- **Entorno y fecha de verificación:** —
- **Dependencias:** Diseño aprobado; #70 desplegada · **Responsable:** agente
- **Estimación restante:** 4–7 d (**desarrollo**)
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
2. **Flujo asistido de producto** (punto 11) — 4–8 d; en paralelo, el propietario ejecuta los pendientes que no dependen de código: Journey/dashboard/proyectos (6), sesión B (12), observación de estados con commit documental (7), esperas de renovación OAuth (8).
3. **Verificaciones reales posteriores al flujo**: Safe Fix tras #70, verificación exacta con rechazos reales (9, 10), identidad con segunda rama/proyecto (3), instalación revocada/desconectada (2) — 5–10 d.
4. **Fiabilidad y operación**: ejecución fiable con cancelación/fallo/reintento reales (4), ensayo de recuperación y limpieza (18), logs y OAuth (13), alertas observadas (14) — 6–12 d.
5. **Documentación y calidad**: cobertura y defectos por impacto (16), triaje de typecheck/pruebas (17), onboarding con revocación (19) — 7–11 d.
6. **Aceptación final** sobre un repositorio autorizado, con decisión explícita (20) — 1–2 d.

**Estimación revisada [E] (2026-10-13), separando desarrollo de comprobación:**
| Tipo de trabajo | Puntos | Rango |
|---|---|---|
| Desarrollo nuevo | 11 (panel, 4–7 d); 5/6 (cambios pequeños D7/D6/D2, 2–5 d); contingencia en 2 y 4 (0–2 d) | **6–14 d** |
| Comprobación / observación (sin código salvo que aparezca un defecto) | 2, 3, 7, 8, 9, 10, 12, 13, 14, 15, 18 (ensayo) | **8–14 d** |
| Documentación | 1, 16, 17 (triaje), 19, 20 | **8–14 d** |
| Investigación | `manual_scan` ≠ `automatic_review` (4/5) | 1–2 d |
Total revisado **24,5–47 días de trabajo** (antes 30–58): la reducción viene de no contar como desarrollo completo lo que solo necesita una comprobación. Esperas externas (reautorización de cliente OAuth, caducidad de 1 h del acceso, sesión B, B1–B8 con el cliente, aprobaciones de fusión/despliegue) no suman esfuerzo pero alargan el calendario. Camino crítico: panel (4–7 d) → comprobaciones reales que lo usan → aceptación; el resto va en paralelo. **Calendario [E]: unas 5–8 semanas naturales** (V1 candidato entre finales de noviembre y mediados de diciembre). Esta cifra cambia si las comprobaciones destapan defectos; no se asume que no los haya.

## Mediciones de fluidez (nuevas; no sustituyen a ningún punto)
Objetivo: saber dónde se pierde tiempo antes de optimizar. **Solo se optimiza un cuello de botella medido, conservando cobertura y controles** (ningún motor se omite ni se reduce el análisis por velocidad).
| Medida | Fuente | Base observada (datos existentes, 16 escaneos de `sequrai-e2e-test`, repo de 13–14 archivos, 2026-10-09/10) | Estado |
|---|---|---|---|
| Espera en cola (creación → inicio) | `scans.created_at → started_at`; `scan_job_events.queue_wait_ms` | 4,2–14,0 s, mediana 5,6 s (`queue_wait_ms` ≈ 1,9–2,4 s en los eventos de trabajo) | observada |
| Ejecución del análisis (inicio → completado) | `scans.started_at → completed_at` | 1,6–2,5 s, mediana ≈ 1,9 s | observada |
| Motores | `engine_executions.duration_ms` (6 escaneos) | opengrep media 1,0 s (máx. 1,2); trivy media 2,2 s (máx. 5,7); crypto ≈ 0 s | observada |
| Veredicto final (completado → veredicto) | `scans.completed_at → production_verdicts.generated_at` | 2,9–10,8 s, mediana 3,75 s | observada |
| Total (creación → veredicto) | ídem | 9,2–24,5 s, mediana 11,6 s | observada |
| Tiempo de respuesta de la interfaz | Navigation Timing del navegador en Mission Control, Journey, dashboard y Proyectos (3 cargas por página) | — | **sin medir**: requiere acciones concretas (abajo) |
| Repositorios de tamaño real | mismas fuentes con un repositorio mayor | — | **sin medir**; no extrapolar de 13 archivos |
Límites: repositorio mínimo; los tiempos de motores externos (opengrep/trivy) crecerán con el tamaño; la ruta `manual_scan` muestra 14,0 s de espera en 1 de 16 casos (valor atípico, causa desconocida). Umbrales objetivo: **por acordar** tras medir un repositorio realista.
**Acciones necesarias antes de medir la interfaz** (no ejecutadas): (1) tu sesión Sequrai con las 4 páginas; (2) yo leo `performance.getEntriesByType("navigation")` y los recursos tras 3 cargas por página en tu pestaña de Chrome — solo lectura, sin POST; (3) opcional: un repositorio mediano desechable propiedad de SequrAI para medir motores (requiere un commit/importación autorizados).

## Decisión actual
**V1 no está listo.** Bloqueos concretos: 11 (no existe flujo de producto), 12 (sesión B), 15 (restricción de Red Team desplegada y observada en tres rutas; falta MCP y UI de otra organización), 6/7 (verificación visual y de estados sin hacer), 4 (ejecución fiable sin observar), 18/19/20 (recuperación, onboarding y demostración final). Esta lista no se marca como verificada hasta que cada punto cumpla su evidencia; la decisión se repite al cerrar cada bloque.

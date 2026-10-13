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
- **Estimación restante:** 0,5–1 d
- **Bloquea V1:** sí

### 2. Conexión GitHub
- **Estado:** en curso
- **Evidencia:** Conexión de `sequrai-e2e-test` por GitHub App y flujo completo verificados en producción (`PILOT_E2E_EVIDENCE_2026-10-09.md`); corrección de falso negativo de instalación inactiva (`637f47a`). **Sin verificar en real:** instalación revocada y repositorio desconectado (solo pruebas locales); permisos mínimos de la App del cliente (B1–B8).
- **Entorno y fecha de verificación:** producción (repo propio), 2026-10-09
- **Dependencias:** Instalación revocada/desconectada: provocarla en un repo de prueba; B1–B8 con el cliente · **Responsable:** agente + propietario
- **Estimación restante:** 2–4 d
- **Bloquea V1:** sí

### 3. Identidad del análisis
- **Estado:** en curso
- **Evidencia:** Verificación ligada al SHA exacto y rechazo de commit sin corrección con análisis limpio posterior: producción 2026-10-09 (`PILOT_E2E_EVIDENCE`, A3). Migración 067 (`proposal_commit_sha`). Pendiente: comprobar organización/proyecto/repositorio/rama de forma explícita en resultados, historial, MCP y verificación con un caso de otra rama y de otro proyecto reales; pruebas locales ya existen (`safe-fix-isolation`, `safe-fix-commit-binding`).
- **Entorno y fecha de verificación:** producción parcial; local completo, 2026-10-09
- **Dependencias:** Repo de prueba con 2 ramas · **Responsable:** agente
- **Estimación restante:** 1–3 d
- **Bloquea V1:** sí

### 4. Ejecución fiable
- **Estado:** pendiente
- **Evidencia:** Estados y recuperación existen en código (`security-jobs/state-machine`, `scan-job-recovery`, `review-cancel`) con pruebas unitarias; **no se han observado en producción** cancelación, fallo, reintento ni recuperación tras caída. Hay una prueba de latencia intermitente preexistente (`worker-run-job.perf.bench`).
- **Entorno y fecha de verificación:** local
- **Dependencias:** Casos reales: cancelar, forzar fallo, reintento sin duplicar · **Responsable:** agente
- **Estimación restante:** 3–6 d
- **Bloquea V1:** sí

### 5. Veredictos respaldados
- **Estado:** en curso
- **Evidencia:** Puerta canónica `deploymentPostureOf` (alta confianza + cobertura completa) usada por MCP, check de GitHub y UI; MCP real devolvió `MORE_ANALYSIS_REQUIRED` con 100/100 (2026-10-09); capturas del propietario confirman lenguaje conservador (2026-10-10). Abierto: D7 (el "100" por área con `evidenceCount 0` se pinta con ✓ verde) y D2 (`introducedBlockers` 1 frente a 22).
- **Entorno y fecha de verificación:** producción, 2026-10-09/10
- **Dependencias:** Decisión de producto sobre D7; corregir D2 · **Responsable:** agente + propietario
- **Estimación restante:** 1–2 d
- **Bloquea V1:** sí (D7 se decide; D2 se clasifica en el punto 16)

### 6. Interfaz coherente
- **Estado:** en curso
- **Evidencia:** #72 desplegada (`3ea5dab`): sin puntuaciones de relleno, tendencia sobre veredictos con evidencia, hitos con fecha/commit/histórico. **Pendiente repetir la comprobación visual** de Journey (puntuaciones "—", tendencia estable, hitos), dashboard/proyectos y D6 (textos en inglés), D8 (nombres de pantalla).
- **Entorno y fecha de verificación:** producción; visual pendiente
- **Dependencias:** Propietario ejecuta V1 (Journey) y dashboard/proyectos · **Responsable:** propietario + agente
- **Estimación restante:** 2–4 d
- **Bloquea V1:** sí

### 7. Actualización de estados
- **Estado:** pendiente
- **Evidencia:** Código: sondeo cada 4 s solo en Mission Control del proyecto mientras haya revisión en curso, pruebas de seguridad o veredicto materializándose; Journey, dashboard y Proyectos no sondean (servidor). **Sin observación real.** Requiere un commit documental autorizado en `sequrai-e2e-test` y que el propietario tenga las páginas abiertas; restauración con un segundo commit (no autorizado aún).
- **Entorno y fecha de verificación:** —
- **Dependencias:** Autorización de los commits; propietario preparado · **Responsable:** propietario + agente
- **Estimación restante:** 1–2 d
- **Bloquea V1:** sí

### 8. MCP real
- **Estado:** en curso
- **Evidencia:** Claude Code real, OAuth, 3 ámbitos, 4 rechazos y herramientas permitidas con datos reales, retirada con rechazo observado del acceso: 2026-10-09 (`PILOT_CLAUDE_CODE_OAUTH_TEST.md`). **Protocolo simulado, no real:** refresco y rechazo del refresco (#66, DB/código). Pendiente: renovación real, y un entorno del cliente declarado compatible (A16).
- **Entorno y fecha de verificación:** producción (Claude Code), 2026-10-09
- **Dependencias:** Esperar caducidad del acceso (1 h) en una sesión real; decisión del entorno del cliente · **Responsable:** agente + propietario
- **Estimación restante:** 1–3 d
- **Bloquea V1:** sí

### 9. Safe Fix consistente
- **Estado:** en curso
- **Evidencia:** Idempotencia/concurrencia (#62) probada en PostgreSQL real y en producción (2026-10-09); correcciones en curso conservadas. #70 (estado persistido) desplegada `7a6c821`: pruebas locales verdes, **sin repetir un `safe_fix` real tras el despliegue** (necesita sesión MCP nueva).
- **Entorno y fecha de verificación:** producción 2026-10-09; local
- **Dependencias:** Sesión MCP nueva (reautorizar cliente) · **Responsable:** agente + propietario
- **Estimación restante:** 0,5–1 d
- **Bloquea V1:** sí

### 10. Verificación exacta
- **Estado:** en curso
- **Evidencia:** Rescan del SHA exacto y `exact_commit_rescan_clean` verificados en producción dos veces (2026-10-09); 409 controlados; `reopen`. Pendiente: demostrar en real el rechazo por otro proyecto/organización/repositorio/rama y que un cambio de propuesta invalida la aprobación (hay pruebas locales: `PROPOSAL_CHANGED_REASON` en `safe-fix-engine/lifecycle`).
- **Entorno y fecha de verificación:** producción parcial
- **Dependencias:** Casos reales con segunda rama/proyecto · **Responsable:** agente
- **Estimación restante:** 1–2 d
- **Bloquea V1:** sí

### 11. Flujo asistido utilizable
- **Estado:** pendiente
- **Evidencia:** **No existe superficie de producto**: la UI solo copia el prompt; aprobar/aplicado/verificar existen solo como API (`/api/projects/{id}/safe-fixes/{id}`), por eso las pruebas se hicieron con la consola del navegador. Mínimo: panel "Corrección asistida" en la página del proyecto (§3 de esta lista).
- **Entorno y fecha de verificación:** —
- **Dependencias:** Diseño aprobado; #70 desplegada · **Responsable:** agente
- **Estimación restante:** 4–8 d
- **Bloquea V1:** **sí**

### 12. Aislamiento entre clientes
- **Estado:** pendiente
- **Evidencia:** Pruebas locales y PostgreSQL (067/068) y 404 entre proyectos de la misma organización en producción. **Falta la sesión B** (usuario real de otra organización no protegida): lectura y escritura sobre proyecto, propuesta Safe Fix, resultados, historial, API MCP.
- **Entorno y fecha de verificación:** producción pendiente
- **Dependencias:** Acción B1 del propietario (cuenta en ventana privada) · **Responsable:** propietario + agente
- **Estimación restante:** 1–2 d
- **Bloquea V1:** **sí**

### 13. OAuth seguro
- **Estado:** en curso
- **Evidencia:** Consentimiento que decide los ámbitos (#63), workspace visible (#68), callbacks validados y errores locales (#69, verificado en producción 2026-10-10), cliente retirado → `invalid_client`. Ausencia de credenciales en logs: prueba de protocolo (#66); **sin revisión de logs reales**.
- **Entorno y fecha de verificación:** producción 2026-10-10
- **Dependencias:** Revisar logs de Vercel de una conexión (sin exponer tokens) · **Responsable:** agente
- **Estimación restante:** 1–2 d
- **Bloquea V1:** sí

### 14. Alertas
- **Estado:** en curso
- **Evidencia:** #71 desplegada: `can_i_deploy` no crea alertas; evaluación en el lote diario (función registrada; cron `30 7 * * *`). **Ejecución del paso nuevo no observada.** Deduplicación y canal in-app documentados en el código; correo solo para críticas.
- **Entorno y fecha de verificación:** producción 2026-10-10 (registro); ejecución sin observar
- **Dependencias:** Ver el historial de Inngest (`evaluate-deploy-decision`) · **Responsable:** propietario
- **Estimación restante:** 0,5–1 d
- **Bloquea V1:** no (informar si falla)

### 15. Red Team fuera de V1
- **Estado:** en curso
- **Evidencia:** Auditoría `RED_TEAM_AUDIT_2026-10-13.md`: las campañas dinámicas y la hipótesis enlatada eran alcanzables por API, UI y MCP. #74 (abierta): cierre en servidor (rutas, servicio, ejecutor, MCP, auditoría), sin hipótesis predeterminada, rollout `internal`; 22 pruebas. No hay afirmaciones de Red Team en la landing ni en el README. Pendiente: fusionar, desplegar y comprobar los 403 en producción.
- **Entorno y fecha de verificación:** local
- **Dependencias:** Autorización de fusión/despliegue de #74 · **Responsable:** agente + propietario
- **Estimación restante:** 0,5–1 d
- **Bloquea V1:** **sí**

### 16. Cobertura y defectos conocidos
- **Estado:** en curso
- **Evidencia:** `PILOT_KNOWN_DEFECTS.md` (D1–D8), límite SQL (`known-gap-sql-concatenation.test.ts`). Falta: documento de cobertura (lenguajes, motores — opengrep/trivy/scorecard/cripto/Red Team estático —, exclusiones, tamaño máximo de archivo 256 KB/200 archivos del Red Team estático) y clasificar cada defecto por impacto en V1.
- **Entorno y fecha de verificación:** docs
- **Dependencias:** — · **Responsable:** agente
- **Estimación restante:** 2–3 d
- **Bloquea V1:** sí

### 17. Calidad de entrega
- **Estado:** en curso
- **Evidencia:** Última ejecución completa (2026-10-13): 3629 tests pasan; 2 fallos preexistentes `api-routes-auth-audit` (autoanálisis, puntuación 79 < 100); `tsc` 107 errores preexistentes (la mayoría en archivos de pruebas); eslint 0 errores; build correcto en las PR. **Sin triaje de los 107 errores por si afectan al recorrido de V1.**
- **Entorno y fecha de verificación:** local/CI, 2026-10-13
- **Dependencias:** — · **Responsable:** agente
- **Estimación restante:** 2–3 d
- **Bloquea V1:** sí (triaje); los errores no relacionados no bloquean

### 18. Operación y recuperación
- **Estado:** en curso
- **Evidencia:** Migraciones 067/068 ensayadas en PostgreSQL real y aplicadas con copia y restauración verificadas (2026-10-09). Despliegue de recuperación identificado pero **nunca ejecutado**; limpieza de datos de prueba (propuestas, tokens retirados, repositorios desechables) pendiente; logs redactados sin revisión sistemática.
- **Entorno y fecha de verificación:** producción 2026-10-09 (migraciones)
- **Dependencias:** Ensayo de redespliegue a un SHA anterior (con autorización) · **Responsable:** agente + propietario
- **Estimación restante:** 2–3 d
- **Bloquea V1:** sí

### 19. Onboarding completo
- **Estado:** en curso
- **Evidencia:** Borradores `PILOT_ONBOARDING_2026-10-12.md` y `PILOT_RUNBOOK_2026-10-12.md`. Faltan: pasos sin consola (depende del punto 11), responsable de soporte y **procedimiento de revocación** (hoy no hay pantalla: la retirada de tokens fue una escritura en base de datos).
- **Entorno y fecha de verificación:** docs
- **Dependencias:** Punto 11; decisión sobre revocación (pantalla mínima o procedimiento operativo) · **Responsable:** agente + propietario
- **Estimación restante:** 3–5 d
- **Bloquea V1:** sí

### 20. Aceptación final
- **Estado:** pendiente
- **Evidencia:** Demostración completa sobre un repositorio autorizado usando solo las superficies del usuario, SHA desplegado, evidencia y limitaciones aceptadas, y decisión explícita listo/no listo.
- **Entorno y fecha de verificación:** —
- **Dependencias:** Todos los bloqueantes anteriores · **Responsable:** propietario + agente
- **Estimación restante:** 1–2 d
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
1. **Cerrar el alcance**: fusionar y desplegar #74 (Red Team cerrado en servidor) y comprobar los 403 en producción — 1 d (puntos 1, 15).
2. **Flujo asistido de producto** (punto 11) — 4–8 d; en paralelo, el propietario ejecuta los pendientes que no dependen de código: Journey/dashboard/proyectos (6), sesión B (12), observación de estados con commit documental (7), esperas de renovación OAuth (8).
3. **Verificaciones reales posteriores al flujo**: Safe Fix tras #70, verificación exacta con rechazos reales (9, 10), identidad con segunda rama/proyecto (3), instalación revocada/desconectada (2) — 5–10 d.
4. **Fiabilidad y operación**: ejecución fiable con cancelación/fallo/reintento reales (4), ensayo de recuperación y limpieza (18), logs y OAuth (13), alertas observadas (14) — 6–12 d.
5. **Documentación y calidad**: cobertura y defectos por impacto (16), triaje de typecheck/pruebas (17), onboarding con revocación (19) — 7–11 d.
6. **Aceptación final** sobre un repositorio autorizado, con decisión explícita (20) — 1–2 d.

**Estimación [E]:** suma de los rangos de la lista = **30–58 días de trabajo de una persona**; con los trabajos del propietario en paralelo y sin esperas externas, el camino crítico es de **unas 6 a 10 semanas naturales** desde el 13 de octubre, es decir, un candidato a V1 entre **finales de noviembre y mediados de diciembre de 2026**, dentro del ciclo (13 de enero de 2027) con margen. La banda superior asume que el flujo asistido, la ejecución fiable y el onboarding con revocación llevan el máximo de su rango. Si algo bloquea, se mueve fecha, no se relaja un criterio.

## Decisión actual
**V1 no está listo.** Bloqueos concretos: 11 (no existe flujo de producto), 12 (sesión B), 15 (restricción de Red Team sin desplegar), 6/7 (verificación visual y de estados sin hacer), 4 (ejecución fiable sin observar), 18/19/20 (recuperación, onboarding y demostración final). Esta lista no se marca como verificada hasta que cada punto cumpla su evidencia; la decisión se repite al cerrar cada bloque.

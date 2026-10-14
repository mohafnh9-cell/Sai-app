# Auditoría del Red Team existente (2026-10-13)

Alcance: solo lectura de código y ejecución de pruebas locales. **No** se ejecutó ningún ataque, scan, migración ni acción sobre producción o repositorios de clientes.
Base: `main` en `3ea5dab` (producción sirve ese SHA). Convención: **[H]** hecho comprobado (archivo/prueba citados); **[E]** estimación o inferencia.

Prueba local de referencia: `npx vitest run server/attack-simulation server/ai-red-team server/security-orchestrator server/security-jobs server/full-product-audit server/security-engines features/attack-simulation fixtures` → **123 archivos pasan, 794 tests pasan, 9 omitidos** [H].

## 0. Qué es "el Red Team" hoy
Son dos cosas distintas que comparten nombre:
1. **Red Team estático** (`server/ai-red-team`, ~38 600 líneas, 372 archivos): el *Security Director* y sus equipos (api, autorización, lógica de negocio, LLM, navegador, descubrimiento) analizan **ficheros del repositorio**, sin red. Lo invoca cada scan (`server/platform-convergence/run-scan-red-team.ts`, máx. 200 archivos de ≤256 KB) [H].
2. **Simulación de ataques dinámica** (`server/attack-simulation`, ~10 500 líneas): campañas/ejecuciones/evidencia/replay con modos `static | mock | sandbox | authorized_staging`; solo `sandbox`/`authorized_staging` hacen HTTP real (`dynamic/http-client.ts`) [H]. Se dispara por API de campañas y por la fase de simulación de un scan; las ejecuciones corren en la función Inngest `attack-execution-run` [H].
Piloto actual: **solo usa el Red Team estático (dentro del scan) y el veredicto**; ninguna prueba dinámica contra aplicaciones de clientes forma parte del piloto [H por diseño del piloto; sin verificar en producción que no existan campañas].

## 1. Matriz de capacidades
### A. Implementada y probada (local/CI)
| Capacidad | Dónde | Pruebas |
|---|---|---|
| Validación de autorización de objetivo (aprobada, no caducada, origen exacto) | `server/ai-red-team/authorization/types.ts` (`validateAttackAuthorization`) | `attack-simulation/__tests__/gate-3-production-safety`, `preconditions`, `runtime` |
| Verificación de propiedad del objetivo (HTTP, DNS TXT, integración con proveedor, repo↔deploy) | `authorization/target-verification.ts`, `github-deployment-ownership.ts`, `dynamic-target-authorization-service.ts` | `authorization/__tests__/target-verification`, `automatic-target-verification`, `github-deployment-ownership`, `dynamic-scope-expansion`, `rate-limit` |
| Bloqueo de IPs privadas/loopback/metadata al verificar (resuelve DNS, falla cerrado) | `target-verification.ts` (`assertHostnameResolvesToPublicAddress`) | `authorization/__tests__/ssrf-hardening` |
| Producción desactivada por defecto (flag + alcance + presupuesto + caducidad) | `dynamic/production-gate.ts` | `gate-3-production-safety` ("production requires explicit flag, scope, budget, expiry") |
| Cliente HTTP dinámico: alcance de origen/ruta, exclusiones, `DELETE` y acciones destructivas bloqueadas, presupuesto, concurrencia, timeout 8 s, redirecciones manuales revalidadas | `dynamic/http-client.ts`, `concurrency-limiter.ts`, `teams/api/runtime/safe-api-runtime.ts` | `http-client`, `http-client-concurrency`, `gate-3` (redirección y presupuesto) |
| 12 sondas dinámicas contra un laboratorio local (sin autenticación, IDOR, rate limit, webhook, idempotencia, mass assignment, escalada, cabeceras, inyección, SSRF, CORS) | `dynamic/probes/index.ts`; laboratorio `fixtures/dynamic-security-lab/server.ts` | `dynamic-http-integration`, `real-dynamic-validation` (fases 1-10) |
| Evidencia con redacción de secretos y huella del cuerpo | `evidence/build-evidence.ts`, `redact.ts` | `evidence-build`, `evidence-redact`, `gate-3` (redacción) |
| Resultado CONFIRMED / NOT_EXPLOITABLE y correlación con estático (CONFIRMED / FALSE_POSITIVE / POTENTIAL); el modo mock nunca confirma | `mitigation/evaluate-outcome.ts`, `full-product-audit/correlate-findings.ts` | `real-dynamic-validation` (fase 8) |
| Aislamiento de tenant en la ejecución (organización/proyecto de la autorización = los del contexto) | `runtime/guards.ts` (`assertTenantOwnership`) | `runtime.test.ts` |
| Cancelación de campaña/ejecución (idempotente) y comprobación entre pasos | `cancel/cancel-attack.ts`, rutas `.../cancel` | `gate-3` (cancelación entre pasos) |
| Trabajo asíncrono: Inngest con límite de concurrencia por organización, tiempo máximo e idempotencia | `inngest/functions/attack-execution-run.ts`, `executor/*` | `executor-run`, `executor-payload`, `executor-stage-map` |
| Repetición tras corrección sobre un hallazgo de ataque | `replay/run-attack-replay.ts`, `compare-evidence.ts` | `replay`, `real-dynamic-validation` (fase 10) |

### B. Implementada sin verificar (o verificada solo de forma indirecta)
| Capacidad | Hecho |
|---|---|
| RLS de las tablas de ataque | `042` (12 tablas, 12 políticas), `047`, `056`. La única prueba (`authorization/__tests__/dynamic-target-verification-rls`) **lee el SQL con expresiones regulares**; no hay prueba de aislamiento entre organizaciones contra PostgreSQL real para estas tablas [H] |
| Ejecución `authorized_staging` contra un host remoto real | Todas las pruebas usan el laboratorio local o mocks; nunca se ha ejecutado contra un origen remoto [H] |
| Runtime de navegador (Playwright) | `teams/browser/runtime/playwright-runtime.ts` existe; ninguna prueba lo referencia (solo el runtime mock) [H] |
| Calidad del Red Team estático (precisión/recall/falsos positivos sobre repos reales) | 57 archivos de pruebas unitarias, pero no hay corpus etiquetado ni métrica de precisión [H]; el equipo LLM depende del modelo (no determinista) [E] |
| Función Inngest `attack-execution-run` en producción | Sin observar una ejecución real en producción [no verificado] |

### C. Parcial
| Capacidad | Qué existe / qué falta |
|---|---|
| **Credenciales de pruebas** | `testCredentialsRef` se guarda pero **nunca se resuelve** a un secreto (solo se propaga; `authorization/store.ts`). Los tokens `test-token-user-a/b/admin` están fijos en `authorized-target.ts:99` y solo en `sandbox`. En `authorized_staging` `testIdentities = {}`, por lo que IDOR y escalada devuelven "omitido" (`probes/index.ts:76-77`) [H] |
| **Mapeo de rutas en staging** | `resolveProbePath` solo devuelve rutas del laboratorio en `sandbox`; en staging exige que los *fixtures* aporten las rutas, si no la sonda se omite. No hay derivación desde el descubrimiento ni desde el alcance aprobado [H] |
| **Límites de red** | Hay: origen, ruta, redirecciones, `DELETE`, presupuesto, concurrencia, timeout. Faltan: comprobación de IP/DNS **en el momento de la petición** (solo al verificar; el propio código documenta el riesgo de DNS rebinding residual, `target-verification.ts`), **tope de tamaño de respuesta** (`response.text()` sin límite, `http-client.ts:185`), y **aislamiento de egreso a nivel de sistema** (`isNetworkEgressEnforced()` es `false` salvo atestación del operador, `security-orchestrator/network-enforcement.ts`) [H] |
| **Cancelación** | Es cooperativa: se comprueba antes de cada petición y entre pasos; una petición en vuelo no se aborta (solo el timeout de 8 s). El "paro de emergencia" es un indicador de sesión en memoria (`runtime/safe-runtime.ts`), **sin interruptor global/operativo** [H] |
| **Origen de hipótesis** | `startAttackCampaign` usa una hipótesis **enlatada** ("Workflow bypass in checkout", fuente `attack_center.demo`, confianza 0,75) cuando la petición no trae hipótesis (`start-attack-campaign.ts`); la UI de campañas no envía hipótesis. La ruta guiada por scan (`integration/extract-hypotheses-from-report.ts`) sí deriva del informe [H] |
| **Falsos positivos** | Estados y correlación existen (arriba); no hay flujo de usuario para marcar/reabrir un falso positivo ni medición de su tasa [H] |
| **Repetición tras corrección** | Existe para hallazgos de ataque (`replay/*`) y `full-product-audit/post-fix-validation`, pero la verificación de Safe Fix del piloto (`safe-fix-engine/verify.ts`) **no usa repetición dinámica** (sin referencias) [H] → dos ciclos de vida separados |
| **Autorización por usuario** | Rutas `attack-authorizations`, `dynamic-target-authorization`, `attack-campaigns` exigen sesión y acceso al proyecto (`requireProjectApiAccess`) y la flag `attack_simulation` (por defecto `"ga"`, `feature-flags/index.ts:50`) [H]; no hay confirmación explícita de alcance por parte de una persona *en la campaña* más allá de la autorización previa [E] |

### D. Ausente
- Resolución de credenciales de prueba (almacén de secretos, tokens de corta vida, referencia → valor) y flujos autenticados con varias identidades en entornos reales.
- Fijación de IP (DNS pinning) y aislamiento de egreso en un *worker* dedicado; atestación `SECURITY_WORKER_NETWORK_ENFORCEMENT_VERIFIED` no establecida.
- Interruptor operativo global ("kill switch") por organización/objetivo.
- Integración de la repetición dinámica con la verificación de Safe Fix (SHA exacto).
- Métrica de falsos positivos/negativos con corpus etiquetado.
- Prueba de aislamiento entre organizaciones contra base de datos real para las tablas de ataque.

## 2. Revisión por criterio (resumen)
| Criterio | Estado | Brecha principal |
|---|---|---|
| Autorización de objetivos | **Sólida en código y pruebas locales** | Nunca ejercida contra un origen remoto; sin confirmación humana por campaña |
| Aislamiento | Parcial | RLS probada solo por texto; guardas en runtime sí probadas |
| Límites de red | Parcial | IP/DNS solo al verificar; sin tope de respuesta; sin egreso aislado |
| Credenciales | Parcial/ausente | Referencia sin resolver; tokens fijos solo en sandbox |
| Cancelación | Parcial | Sin abortar peticiones en vuelo; sin interruptor global |
| Trabajos | Implementado, sin observar en producción | Inngest con concurrencia/idempotencia; verificado solo en pruebas |
| Evidencia | Sólida | Vista previa de 240 caracteres redactada; sin volcado del cuerpo (bien); sin retención/borrado definidos [E] |
| Falsos positivos | Parcial | Sin flujo de usuario ni medición |
| Repetición tras corrección | Parcial | No conectada a Safe Fix |

## 3. Riesgos para el piloto (a vigilar, no bloquean el piloto actual)
1. **Hipótesis enlatada** puede presentar un hallazgo no derivado del repositorio (campañas creadas desde la UI).
2. **Producción dinámica** queda protegida solo por una variable de entorno global (`SEQURAI_PRODUCTION_DYNAMIC_ENABLED`) + la autorización; sin interruptor operativo.
3. **Confusión de nombres**: "Red Team" estático (dentro de cada scan) y "Prueba de seguridad" dinámica son productos distintos.

## 4. Accesibilidad actual de las campañas dinámicas y de la hipótesis predeterminada (main `3ea5dab`)
Comprobado en código: **eran alcanzables** y la restricción es de servidor (#74):
- **API:** `POST /api/projects/{id}/attack-campaigns` (flag `attack_simulation` en `"ga"`) aceptaba `runtimeMode: sandbox | authorized_staging` con `authorizationId` y `targetUrl`, y sin `hypotheses` creaba la hipótesis enlatada `demo-workflow-bypass`; `POST attack-authorizations` y `dynamic-target-authorization` creaban autorizaciones.
- **UI:** pestaña/página "Attack Center" (flag GA) y la fase "Attack simulation" de Mission Control.
- **MCP:** `authorize_dynamic_target` no comprobaba la flag (solo el ámbito `mcp:target:authorize`; las claves heredadas lo tienen); `full_product_audit` podía resolver un destino de staging.
- **Pipeline de scan:** cada scan creaba una campaña *mock* a partir del informe del Red Team (sin red) cuando la flag era GA.
Cierre en #74: variable de operador `SEQURAI_DYNAMIC_SECURITY_TESTING_ENABLED` (cerrada por defecto) comprobada en rutas, servicio, ejecutor, MCP y resolución del destino de auditoría; sin hipótesis predeterminada; rollout `internal`. No se leyó el entorno de producción: si existe un `SEQURAI_FEATURE_FLAGS_JSON` que reabre la flag, la UI lo seguiría, pero los cierres de servidor se mantienen.

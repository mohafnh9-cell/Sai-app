# Piloto supervisado — checklist única del sprint (objetivo técnico: 11 de octubre)

Leyenda de entornos (nunca se mezclan): **L** = pruebas locales/CI (código, base de datos de prueba local) · **M** = agente MCP real contra producción · **P** = producción (aplicación, scanner cloud y base de datos reales).
Estado: **aprobado** (observado en ese entorno) · **pendiente** · **fallido**. "Aprobado L" no equivale a aprobado P.
Última actualización: 2026-10-09. PR abiertas: #59 (docs), #60, #61, #62 (código, sin fusionar ni desplegar).

## A. Preparación técnica del piloto (debe quedar validada el día 11)

| # | Criterio | L | M | P | Estado | Evidencia / bloqueo |
|---|---|---|---|---|---|---|
| A1 | Flujo asistido completo con repositorio, scanner cloud y base de datos reales | ✔ | — | ✔ (vía API) | **pendiente** | E2E del 2026-10-09 en `sequrai-e2e-test` (`PILOT_E2E_EVIDENCE_2026-10-09.md`). Falta el primer tramo **por MCP** (A2) y repetirlo con el código nuevo (#60–#62) desplegado |
| A2 | Recorrido MCP desde un agente real (conexión, autenticación, proyecto, análisis, hallazgos, propuesta) | ✔ (handlers) | **pendiente** | ✔ (401 sin credencial) | **pendiente** | Bloqueado: falta una credencial MCP válida (ver "Acciones humanas"). Probado: sin credencial y con clave inventada → 401 `invalid_token`; detección OAuth 200 |
| A3 | Verificación vinculada al SHA exacto; negativos rechazados | ✔ | — | ✔ | **aprobado** | Producción 2026-10-09: positivo F; negativos (commit sin arreglo con un análisis limpio posterior, SHA sin análisis, SHA mal formado, commit base, `reopen` fuera de `FAILED`) |
| A4 | Migración 067: aplicada, registros antiguos intactos, respuestas reales de PostgREST | ✔ | — | ✔ | **aprobado** | Copia + restauración verificadas; 9 registros idénticos byte a byte antes/después; `42703` / `PGRST204` observados |
| A5 | Aislamiento entre organizaciones con dos sesiones reales | ✔ (unit + PostgreSQL) | — | ✔ solo entre proyectos de la misma org (404) | **pendiente** | Falta la sesión B (usuario de una org de prueba no protegida, no miembro de Sequrai). Script exacto en `PILOT_MANUAL_CHECKS_2026-10-09.md` §2 |
| A6 | Journey y polling visible (primer plano y al volver de otra pestaña) | ✔ (lógica) | — | **pendiente** | **pendiente** | Paso visual 1 enviado, esperando resultado. Hasta observarlo no se da por superado ningún paso |
| A7 | Estados históricos no se presentan como aprobación actual (Mission Control, Journey, Protection, brain de proyecto) | ✔ | — | ✔ por API; visual **pendiente** | **pendiente** | API del brain de proyecto verificada en producción; **el brain de proyecto no tiene componente visible**. Journey/Mission Control: guía visual |
| A8 | Dashboard y Proyectos (OrgBrain) no presentan un veredicto anterior como actual | ✔ (#61) | — | **pendiente** | **pendiente** | Defecto reproducido y corregido en #61 (sin desplegar). Verificación visual: paso 10 de la guía |
| A9 | `verify` fuera de `APPLIED` → 409 controlado; verificación a medias no deja `VERIFYING` atascado | ✔ (#60) | — | **pendiente** | **pendiente** | #60 sin desplegar; hoy producción responde 500 en el primer caso |
| A10 | `safe_fix` repetido/concurrente: reutiliza; nunca sustituye APPROVED/APPLIED/VERIFYING | ✔ (#62) | **pendiente** | **pendiente** | **pendiente** | #62 (apila sobre #60). Migración 068 opcional, **no aplicada**; comprobada en PostgreSQL real local |
| A11 | Errores controlados y procedimiento de recuperación probado | ✔ | — | ✔ parcial | **pendiente** | `reopen` y recuperación del 409 por cambio de SHA: probados en producción. Falta producción para A9/A10 |
| A12 | Documentación consistente con lo observado | — | — | — | **pendiente** | Revisión final el día 11 |
| A13 | Limitación SQL en el motor cloud | ✔ (nativo) | — | **pendiente** | **pendiente (aceptado como límite)** | Reproductor `known-gap-sql-concatenation.test.ts`; la comprobación en la nube requiere un commit adicional de prueba (sin autorizar) |

## B. Comprobaciones de la instalación del cliente (durante el onboarding; no se ha accedido a ella)

| # | Criterio | Estado | Cómo / evidencia esperada |
|---|---|---|---|
| B1 | Un único repositorio seleccionado ("Only select repositories", exactamente uno) | pendiente | Captura del cliente (`PILOT_MANUAL_CHECKS` §3.1) |
| B2 | Permisos reales de la GitHub App | pendiente | Captura + `GET /api/github/app/status` desde su sesión: contents/metadata/pull_requests lectura; checks/statuses/hooks escritura; **sin** escritura de código ni de PR. Instalación de pruebas ya verificada con ese conjunto |
| B3 | `github_auth_mode = github_app` en su proyecto | pendiente | Consulta nuestra tras conectar |
| B4 | Sin OAuth heredado (`repo admin:repo_hook`) | pendiente | Procedimiento en §3.5; revocar si ya inició sesión así |
| B5 | Primer análisis y cobertura explicados | pendiente | Aviso de cobertura revisado con el cliente |
| B6 | Credencial MCP del cliente con el mínimo necesario | pendiente | **Usar OAuth con ámbitos acotados, no una clave `seq_live_…`** (ver §C) |
| B7 | Aceptación escrita de límites (no escribimos en su repo; "evidencia limitada" ≠ aprobación; cobertura SQL parcial) | pendiente | Documento firmado/confirmado |
| B8 | Responsables y canal | pendiente | Quién ejecuta `approve`/`applied`/`verify`/`reopen` (equipo SequrAI), quién hace el commit (agente del cliente) |

## C. Semántica real de MCP (revisión de código; **L**, salvo lo marcado)

**Herramientas del servidor (9):** `can_i_deploy`, `what_changed`, `production_history` (ámbito `mcp:status:read`), `discover_application` (`mcp:discover:read`), `safe_fix` (`mcp:fix:read`), `review_now`, `cancel_review` (`mcp:review:run`), `full_product_audit` (`mcp:audit:run`), `authorize_dynamic_target` (`mcp:target:authorize`).

**Autenticación (hallazgo que corrige una indicación anterior):**
- Las **claves `seq_live_…` no tienen ámbitos**: `assertToolScope` devuelve sin comprobar nada para `authType = api_key` (probado: `scopes.test.ts` "allows legacy API key for all tools"). Una clave da acceso a **todas** las herramientas de la organización, incluidas `review_now`, `full_product_audit` y `authorize_dynamic_target`. No se puede crear una clave "solo lectura". *Lo que dije antes de crear una clave con tres ámbitos no es posible.*
- Los **tokens OAuth** sí llevan ámbitos, y la comprobación `assertToolScope` se ejecuta al principio de `executeTool` (antes de cualquier código de la herramienta): un token sin el ámbito recibe 403 `insufficient_scope`. **No hay forma de eludirla con OAuth.**
- **Recomendación para el cliente y para nuestra prueba MCP:** OAuth con `mcp:status:read mcp:discover:read mcp:fix:read` (sin `review:run`, `audit:run`, `target:authorize`). Con clave, solo en la organización de pruebas.

**Semántica de `mcp:fix:read` y de `safe_fix` (L):**
- El nombre dice "read", pero `safe_fix` **escribe en la base de datos de SequrAI** cuando devuelve una instrucción (`prompt_ready`): crea un registro `safe_fix_records` (estado `READY`) con su evento de ciclo de vida, y un evento de memoria de producción. No escribe en GitHub ni en el repositorio del cliente.
- No se eluden permisos: la puerta de ámbitos precede a esa escritura; la organización sale de la credencial; el proyecto se resuelve **dentro** de esa organización (`resolveMcpProject`); el registro lleva `organization_id`/`project_id` con clave foránea de coherencia.
- Con #62 la escritura es idempotente por recomendación + análisis base (acotada, sin duplicados) y nunca sustituye correcciones en curso.
- **No se cambian los ámbitos ahora.** Una migración compatible, si se decide, sería: añadir `mcp:fix:propose` como ámbito nuevo, aceptar durante un periodo **ambos** (`mcp:fix:read` seguiría concediendo `safe_fix`), emitir los tokens nuevos con el ámbito nuevo, avisar, y retirar el alias solo cuando no queden tokens activos con el antiguo. No requiere tocar claves existentes (ya acceden a todo).

**`can_i_deploy` (L):** proyecto resuelto dentro de la organización de la credencial; decisión del veredicto **persistido** de la rama por defecto; si hay análisis en curso, fallido, cancelado o un análisis completado sin veredicto → `MORE_ANALYSIS_REQUIRED` (nunca aprobación); devuelve `verdictScanId`, `reviewedCommitSha`, `latestDetectedCommitSha`, `stale`, `freshnessStatus`, cobertura evaluada. **Límite:** la respuesta no incluye explícitamente la rama ni el repositorio (están implícitos: rama por defecto del proyecto); el agente debe comparar `reviewedCommitSha` con su commit.

**`what_changed` (L):** compara el veredicto actual con el **anterior** (no con "mi commit"); los bloqueos "resueltos" son los que ya no aparecen **y solo si** el análisis actual tiene evidencia suficiente; el propio texto lo etiqueta "no verificado de forma independiente". Devuelve `comparisonReflectsCurrentVerdict`, `currentCommitSha`, `previousCommitSha`. **Para el piloto: `what_changed` NO es la verificación.** La verificación por commit exacto es la de la API (A3).

**Dónde interviene el equipo por API (no hay herramienta MCP para esto):** `GET …/safe-fixes` (localizar el registro creado por `safe_fix`), `approve`, `applied` con `commitSha`, `verify`, `reopen`. Procedimiento con respuestas esperadas: `PILOT_MANUAL_CHECKS_2026-10-09.md` §4.

**Instrucción al agente del cliente:** llamar a `safe_fix` una vez por bloqueo. (Con #62 una repetición ya es segura, pero no depende de ello.)

## Acciones humanas pendientes
1. Credencial MCP válida para la organización de pruebas (preferible OAuth con los tres ámbitos de lectura) y reiniciar esta sesión para usar las herramientas.
2. Sesión B (aislamiento entre organizaciones).
3. Resultado del paso visual 1 (Mission Control) y continuar la guía.
4. Autorización conjunta de despliegue (solicitud única, abajo).

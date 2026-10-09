# Piloto supervisado — checklist única del sprint (objetivo técnico: 11 de octubre)

Leyenda de entornos (nunca se mezclan): **L** = pruebas locales/CI (código, base de datos de prueba local) · **M** = agente MCP real contra producción · **P** = producción (aplicación, scanner cloud y base de datos reales).
Estado: **aprobado** (observado en ese entorno) · **pendiente** · **fallido**. "Aprobado L" no equivale a aprobado P.
Última actualización: 2026-10-09 (tarde). **Desplegado:** #60, #62, #61 (despliegue 6960499262, SHA `0a076ed`) y migraciones 067 y 068. #59 (docs) en esta fusión.

## 0. Condiciones del piloto (alcance acotado)
1. **Un solo repositorio**, seleccionado mediante la GitHub App ("Only select repositories").
2. **Solo la rama principal (por defecto).** Los veredictos, la propuesta y la verificación se refieren a esa rama; un análisis de otra rama no cuenta como evidencia (la verificación exige la misma rama que el análisis base). Commits en otras ramas quedan fuera del piloto.
3. **Una sola corrección asistida en curso a la vez.** Es una **norma de procedimiento**, no una garantía técnica: el índice de la migración 068 limita a una corrección abierta por *(proyecto, id de recomendación)*; dos recomendaciones distintas podrían estar abiertas a la vez. Hasta que exista una cola, el equipo SequrAI no inicia otra corrección hasta cerrar la anterior (`VERIFIED`, `FAILED` o `SUPERSEDED`).
4. SequrAI no escribe en el repositorio del cliente (ver permisos de la GitHub App) y el agente del cliente hace el commit.
5. MCP del cliente por **OAuth con permisos mínimos** (§C); nunca claves `seq_live_…`.
6. Los ids de recomendación son **posicionales**: un mismo id puede nombrar otro hallazgo en un análisis posterior. `safe_fix` nunca reutiliza en silencio una propuesta de otro análisis (reutiliza solo con el mismo análisis base); con una corrección en curso de un análisis anterior responde `in_flight` (conservador) y nombra su título y análisis (PR #64).

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
| A8 | Dashboard y Proyectos (OrgBrain) no presentan un veredicto anterior como actual | ✔ (#61) | — | **desplegado; sin observar** | **pendiente** | Defecto reproducido y corregido en #61 (desplegado). Verificación **visual** pendiente: paso 10 de la guía (nadie lo ha observado) |
| A9 | `verify` fuera de `APPLIED` → 409 controlado; verificación a medias no deja `VERIFYING` atascado | ✔ (#60) | — | ✔ (409) | **aprobado** (409 en producción) | 6 × 409 sin cambios sobre un registro `VERIFIED`. El caso "falla a medias → `FAILED`" solo está probado en local (no se provocó un fallo en producción) |
| A10 | `safe_fix` repetido/concurrente: reutiliza; nunca sustituye APPROVED/APPLIED/VERIFYING | ✔ (#62; PostgreSQL real local) | **pendiente** (vía MCP) | ✔ (vía API) | **aprobado por API; pendiente por MCP** | Producción: 5 simultáneas → 1 registro; repetición con `APPROVED` preservado; `in_flight` 409 conservando el registro; BD sin duplicados abiertos ni pérdidas. Migración 068 **aplicada** |
| A11 | Errores controlados y procedimiento de recuperación probado | ✔ | — | ✔ | **aprobado** | `reopen`, 409 por cambio de SHA, 409 de A9, `in_flight`. Recuperación de servicio: redeploy 6958950455 (`c8ada24`), columnas e índice se conservan. Retirar el índice solo con motivo (efecto: vuelve la convergencia por reconciliación, sin garantía estricta ante carreras) |
| A12 | Documentación consistente con lo observado | — | — | — | **pendiente** | Revisión final el día 11 |
| A14 | OAuth con permisos mínimos: una conexión real concede **exactamente** `mcp:status:read mcp:discover:read mcp:fix:read` y las demás herramientas se rechazan | ✔ (#63: pista en el 401 + el consentimiento decide la concesión; revisar `PILOT` §C) | **pendiente** (conexión real) | **pendiente** | **pendiente** | Hallazgo: sin `scope` el servidor concedía los 6 y la pantalla no podía recortar. #63 (abierta, sin desplegar) hace opt-in los 3 ámbitos sensibles. **Criterio de aceptación:** observar la pantalla de consentimiento (3 marcadas, 3 sin marcar), la conexión resultante con exactamente 3 ámbitos y el rechazo 403 `insufficient_scope` de `review_now`, `cancel_review`, `full_product_audit`, `authorize_dynamic_target` |
| A15 | Ids posicionales: nunca se reutiliza en silencio la propuesta de otro hallazgo | ✔ (#64, abierta) | — | — | **pendiente de fusionar** | Sin defecto: la reutilización exige el mismo análisis base. Pruebas nuevas con hallazgos distintos bajo el mismo id |
| A16 | Integración OAuth con el **entorno que usará el cliente** | — | **pendiente** | **pendiente** | **pendiente** | No se ha decidido/verificado qué cliente MCP usará el cliente. La prueba del conector web de claude.ai (`sequrai-claude-desktop`) cuenta **solo para ese cliente**. Requisitos para Claude Code en la sección "Clientes OAuth" |
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
- **Qué pide realmente el cliente no se ha observado** (hace falta la conexión real). Hoy, sin #63 desplegada, un cliente que omite `scope` o pide todos los anunciados obtiene los 6; la pantalla de consentimiento no puede recortar. Con #63 la concesión la decide quien aprueba: los 3 ámbitos sensibles empiezan sin marcar y, sin selección, el servidor solo concede los no sensibles. Tokens ya emitidos y claves heredadas no cambian.

**Semántica de `mcp:fix:read` y de `safe_fix` (L):**
- El nombre dice "read", pero `safe_fix` **escribe en la base de datos de SequrAI** cuando devuelve una instrucción (`prompt_ready`): crea un registro `safe_fix_records` (estado `READY`) con su evento de ciclo de vida, y un evento de memoria de producción. No escribe en GitHub ni en el repositorio del cliente.
- No se eluden permisos: la puerta de ámbitos precede a esa escritura; la organización sale de la credencial; el proyecto se resuelve **dentro** de esa organización (`resolveMcpProject`); el registro lleva `organization_id`/`project_id` con clave foránea de coherencia.
- Con #62 la escritura es idempotente por recomendación + análisis base (acotada, sin duplicados) y nunca sustituye correcciones en curso.
- **No se cambian los ámbitos ahora.** Una migración compatible, si se decide, sería: añadir `mcp:fix:propose` como ámbito nuevo, aceptar durante un periodo **ambos** (`mcp:fix:read` seguiría concediendo `safe_fix`), emitir los tokens nuevos con el ámbito nuevo, avisar, y retirar el alias solo cuando no queden tokens activos con el antiguo. No requiere tocar claves existentes (ya acceden a todo).

**`can_i_deploy` (L):** proyecto resuelto dentro de la organización de la credencial; decisión del veredicto **persistido** de la rama por defecto; si hay análisis en curso, fallido, cancelado o un análisis completado sin veredicto → `MORE_ANALYSIS_REQUIRED` (nunca aprobación); devuelve `verdictScanId`, `reviewedCommitSha`, `latestDetectedCommitSha`, `stale`, `freshnessStatus`, cobertura evaluada. **Límite:** la respuesta no incluye explícitamente la rama ni el repositorio (están implícitos: rama por defecto del proyecto); el agente debe comparar `reviewedCommitSha` con su commit.

**`what_changed` (L):** compara el veredicto actual con el **anterior** (no con "mi commit"); los bloqueos "resueltos" son los que ya no aparecen **y solo si** el análisis actual tiene evidencia suficiente; el propio texto lo etiqueta "no verificado de forma independiente". Devuelve `comparisonReflectsCurrentVerdict`, `currentCommitSha`, `previousCommitSha`. **Para el piloto: `what_changed` NO es la verificación.** La verificación por commit exacto es la de la API (A3).

**Clientes OAuth (qué se ha comprobado y qué no):**
- **Registro dinámico apagado** (`MCP_OAUTH_DCR_ENABLED` no es `true`; los metadatos no anuncian `registration_endpoint`). Hay tres clientes públicos preregistrados: `sequrai-mcp-inspector` (`http://localhost:6274/oauth/callback`), `sequrai-claude-desktop` (`https://claude.ai|claude.com/api/mcp/auth_callback`, el conector web de claude.ai) y `sequrai-chatgpt`.
- **Claude Code sí admite un cliente preregistrado** (documentación y `claude mcp add --help`, v2.1.281): `--client-id`, `--callback-port` y, en `.mcp.json`, `oauth.scopes` (cadena separada por espacios, el modo documentado de restringir ámbitos y que tiene precedencia sobre los descubiertos). Su redirect URI es **`http://localhost:PORT/callback`** (literalmente `localhost`; la v2.1.229 enviaba `127.0.0.1` y se corrigió en la v2.1.231), con coincidencia exacta.
- **Por tanto, la configuración actual no es compatible con Claude Code, pero no es una limitación general:** ningún cliente registrado tiene `http://localhost:PORT/callback` (el del inspector usa `/oauth/callback`). Hace falta registrar un cliente público con ese URI (p. ej. `sequrai-claude-code`, puerto fijo) —un cambio de datos en producción que **requiere autorización**— y añadir al `.mcp.json` / `claude mcp add --transport http --client-id <id> --callback-port <puerto>` más `oauth.scopes: "mcp:status:read mcp:discover:read mcp:fix:read"`. Las reglas de redirect de SequrAI aceptan ese URI. Sin preparar ni aplicar aún.
- El `.mcp.json` actual (cabecera `Authorization` fija con un valor no válido) no puede usar OAuth mientras tenga esa cabecera.
- `tools/list` devuelve las nueve herramientas con cualquier ámbito (el cliente las ve todas); las no concedidas se rechazan al llamarlas, como resultado JSON-RPC con `isError: true` y `code: insufficient_scope` (HTTP 200), antes de resolver el proyecto o ejecutar nada.
- El refresco conserva los ámbitos reducidos (prueba de protocolo en #66); la reutilización de un refresh token revoca la familia de refresh tokens, pero un access token ya emitido sigue válido hasta su caducidad de 1 h.

**Dónde interviene el equipo por API (no hay herramienta MCP para esto):** `GET …/safe-fixes` (localizar el registro creado por `safe_fix`), `approve`, `applied` con `commitSha`, `verify`, `reopen`. Procedimiento con respuestas esperadas: `PILOT_MANUAL_CHECKS_2026-10-09.md` §4.

**Instrucción al agente del cliente:** llamar a `safe_fix` una vez por bloqueo. (Con #62 una repetición ya es segura, pero no depende de ello.)

## Acciones humanas pendientes
1. Credencial MCP válida para la organización de pruebas (preferible OAuth con los tres ámbitos de lectura) y reiniciar esta sesión para usar las herramientas.
2. Sesión B (aislamiento entre organizaciones).
3. Resultado del paso visual 1 (Mission Control) y continuar la guía.
4. Autorización conjunta de despliegue (solicitud única, abajo).


## Registro de cambios efectivos y de recuperación (2026-10-09)
**Aclaración sobre el "rollback":** **no se ejecutó ningún rollback.** En los informes aparece "Recuperación" como un procedimiento *identificado* (redeploy del despliegue estable anterior, conservando datos, columnas e índice), no como una acción realizada. No se redesplegó nada anterior, no se eliminó ninguna columna ni dato y no se retiró el índice 068. Despliegue estable de referencia hoy: 6960713230 (`b2c3a027`; el código es el de `0a076ed`, 6960499262); el estable previo al lote era 6958950455 (`c8ada24`).

Cambios efectivos y motivo:
| Cambio | Motivo |
|---|---|
| Copias locales de las tablas de Safe Fix + restauración en PostgreSQL local (dos lotes) | Respaldo recuperable antes de migrar |
| Migración **067** (`proposal_commit_sha`, nullable) | Verificación ligada al SHA exacto |
| Migración **068** (índice único parcial, una corrección abierta por proyecto + recomendación) | Garantía estricta frente a creaciones simultáneas |
| Fusión y despliegue de #57, #58, #55, #56, #54, #60, #62, #61, #59 | Correcciones y documentación del flujo (cada una con su CI) |
| Commits de prueba en `mohafnh9-cell/sequrai-e2e-test`: 4 (primer E2E) + 4 (segundo); cada serie termina con un commit que restaura el árbol base; sin reescribir historial | Validar la verificación por SHA exacto y la repetición/concurrencia |
| Análisis que esos pushes dispararon + 1 análisis manual (comprobación del brain en un análisis real) | Evidencia de producción |
| Datos de prueba creados en producción: registros Safe Fix `69b2b7eb…` y `e8283511…` (ambos `VERIFIED`), sus eventos y verificaciones | Resultado de las pruebas; se conservan como evidencia |
| Ningún cambio de ámbitos MCP, de credenciales ni de configuración | — |

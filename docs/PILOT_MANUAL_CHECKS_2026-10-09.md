# Piloto — comprobaciones manuales, aislamiento, GitHub App del cliente y procedimiento Safe Fix

Estado de este documento: procedimientos para ejecutar. **Nada de lo marcado "pendiente" está verificado.** Ningún paso de aquí lanza un análisis sin que una persona lo decida.

Constantes (entorno de prueba, organización Sequrai):
- `APP` = `https://sequrai-app.vercel.app`
- `P` = `2005075a-fc80-4bcc-a080-52bf8195cf2f` (proyecto `sequrai-e2e-test`)
- Mission Control: `APP/projects/P/mission-control` · Journey ("Historial"): `APP/projects/P/journey`
- Registro Safe Fix de prueba: `69b2b7eb-c9ab-4ce0-9f39-c9a54d0b28ca` (estado `VERIFIED`)

## 1. Guía manual: Journey, sondeo visible y brain (una persona, navegador real)

Preparación: sesión iniciada en la organización Sequrai, pestaña **A** (Mission Control), pestaña **B** (Journey), pestaña **C** (cualquier página de `APP`, para la consola). En A abre DevTools → *Network* → filtro `mission-control`. Ejecuta el paso 3 **solo cuando quieras consumir un análisis** (el botón lanza un análisis del repositorio de prueba).

Registro de evidencia (una fila por paso): hora (hh:mm:ss), captura de pantalla con la hora visible, y lo observado. Plantilla al final de §1.

| # | URL / dónde | Acción (una) | Resultado esperado |
|---|---|---|---|
| 1 | Pestaña A: `APP/projects/P/mission-control` | Cargar la página y esperar a que termine | Veredicto actual visible (hoy: "Sin bloqueos — evidencia limitada", **no** "Listo para desplegar"). Anota el commit mostrado |
| 2 | Pestaña B: `APP/projects/P/journey` | Cargar la página | "Postura de despliegue": "Sin bloqueos encontrados — evidencia limitada, no es una aprobación de despliegue" |
| 3 | Pestaña C, consola | Pegar y ejecutar el fragmento de §1.1 (monitor del brain) | Imprime una línea inicial: `current · null · <scan actual> · false` |
| 4 | Pestaña A | Pulsar **"Volver a escanear"** (anota la hora) | La página pasa a **"Analizando tu código…"**; **no** aparece el veredicto anterior como decisión actual; en *Network* aparecen peticiones a `mission-control` cada ~4 s |
| 5 | Pestaña C | Mirar la consola durante el análisis (≈ 20–30 s) | Secuencia: `historical_review_in_progress · <análisis nuevo> · <anterior> · false` → `pending_verdict · null · null · false` → `current · null · <análisis nuevo> · false` |
| 6 | Pestaña B (en cuanto pulses en el paso 4) | **Recargar** (F5) cada ~10 s hasta que termine | Mientras corre: **"Análisis en curso — aún no hay decisión de seguridad final para este análisis"**. Nunca la postura anterior. Tras terminar y recargar: la postura del veredicto nuevo |
| 7 | Pestaña A | Esperar sin tocar nada | El veredicto nuevo aparece **sin recargar**; en *Network* las peticiones a `mission-control` **se detienen** |
| 8 | Pestaña A | Repetir 4 y, justo después, **cambiar a otra pestaña** ~20 s y volver | Al volver, la página converge al veredicto nuevo en ≤ ~4 s (inmediato si pasó más de 1 min); nunca queda el estado "analizando" ni el veredicto anterior como actual |
| 9 | Pestaña A | Tras el análisis de 8, pulsar F5 | Coincide con lo que mostraba tras converger |

Criterios de fallo (anótalos tal cual): se ve el veredicto anterior como decisión actual durante el análisis; Journey muestra la postura anterior durante el análisis; la página no converge tras volver a primer plano; el sondeo no se detiene; el brain muestra `current` con el análisis anterior mientras corre otro.

### 1.1 Fragmento de consola (pestaña C; solo lee la API del brain, imprime solo cuando cambia)
```js
(()=>{const P='2005075a-fc80-4bcc-a080-52bf8195cf2f';let prev='';
const id=setInterval(async()=>{const b=(await (await fetch(`/api/brain/project/${P}`,{cache:'no-store'})).json()).brain;
const row=[b.verdictState,b.reviewInProgress?.scanId?.slice(0,8)??null,b.currentVerdict?.scanId?.slice(0,8)??null,b.productionReady.readyForProduction].join(' · ');
if(row!==prev){console.log(new Date().toISOString(),row);prev=row;}},700);
window.stopBrainMonitor=()=>clearInterval(id);})();
```
Detener con `stopBrainMonitor()`.

### 1.2 Plantilla de evidencia
| # | hh:mm:ss | Captura (archivo) | Observado | ¿Coincide? |
|---|---|---|---|---|

Límites: esta guía comprueba la **interfaz** (lo que el brain devuelve por API ya se verificó en segundo plano el 2026-10-09; no sustituye los pasos 4–8).

## 2. Aislamiento entre organizaciones (dos sesiones reales)

**Acceso que falta (no se puede completar sin él):** una sesión real de un **usuario B** que (a) pertenece a una organización de prueba **no protegida** y (b) **no** es miembro de Sequrai. No sirven credenciales administrativas ni la clave de servicio como sustituto, ni `test-ai-g7r2` ni el proyecto protegido. Debe abrirse en un perfil/ventana privada distinta de la sesión A.

Usar el registro `VERIFIED` (los intentos de escritura son inocuos aunque falle el control: `reopen`/`approve` sobre `VERIFIED` devuelven 409).

Con la sesión **B** (consola de `APP`):
| # | Petición | Esperado (nunca 200 con datos) |
|---|---|---|
| 1 | `GET /api/projects/P/safe-fixes` | 404 `{"error":"Not found"}` |
| 2 | `GET /api/projects/P/safe-fixes/<id>` | 404 |
| 3 | `POST /api/projects/P/safe-fixes/<id>` `{"action":"verify"}` | 404 |
| 4 | `POST …` `{"action":"approve"}` y `{"action":"reopen"}` | 404 |
| 5 | `GET /api/brain/project/P` | 404 o 403 |
| 6 | `GET /api/projects/P/mission-control` y `/protection-center` | 404 |
| 7 | (opcional) con un proyecto `PB` propio de B: `GET /api/projects/PB/safe-fixes/<id de Sequrai>` | 404 |
Después, con la sesión **A**: `GET /api/projects/P/safe-fixes/<id>` → sigue `VERIFIED`, mismo `updatedAt`. Evidencia: captura de consola con petición y respuesta de cada fila y la hora.

Ya verificado (no sustituye lo anterior): mismo `safeFixId` bajo **otro proyecto de la misma organización** → 404 en GET y POST (producción, 2026-10-09); filtros por organización/proyecto en pruebas unitarias y RLS en PostgreSQL real (`scripts/db-check-067.sh`).

## 3. Checklist con el cliente: GitHub App (sin acceder todavía a su instalación)

Lo hace el cliente (o se hace en llamada compartida); cada punto se acepta con una captura suya.
1. **Un único repositorio.** GitHub → *Settings → Applications → Installed GitHub Apps → SequrAI → Configure*: *Repository access* = **Only select repositories**, con **exactamente uno** (el del piloto). No "All repositories".
2. **Permisos.** En esa misma pantalla, *Permissions* = `Contents: Read`, `Metadata: Read`, `Pull requests: Read`, `Checks: Read and write`, `Commit statuses: Read and write`, `Webhooks: Read and write`. **Sin** `Contents: write`, `Pull requests: write`, `Administration`, `Secrets`, `Issues: write`.
3. **Confirmación en SequrAI** (sesión del cliente): `GET APP/api/github/app/status` → `installation.status: "active"`, `repositorySelection: "selected"`, `permissions` idéntico a (2). (En el entorno de prueba devuelve exactamente ese conjunto.)
4. **Modo de autenticación del proyecto:** `github_auth_mode = github_app` (nosotros lo comprobamos en base de datos tras la conexión; no `oauth_legacy`).
5. **OAuth heredado.** No conectar repositorios con "Continuar con GitHub" (pide `repo admin:repo_hook`). Si el cliente ya inició sesión así: *GitHub → Settings → Applications → Authorized OAuth Apps → SequrAI*: revocar o confirmar que no existe.
6. **Primer análisis:** el cliente confirma qué archivos/áreas quedan fuera (aviso de cobertura) y acepta por escrito los límites: SequrAI no modifica su código; "evidencia limitada" no es aprobación; la cobertura de inyección SQL es parcial.
Pendiente de coordinar con el cliente; **no se ha accedido** a su instalación ni repositorio.

## 4. Procedimiento manual de Safe Fix durante el piloto (sin ambigüedad)

Lo ejecuta el equipo de SequrAI por API (`POST APP/api/projects/<P>/safe-fixes[/<id>]`, sesión de miembro). **Regla de oro: tras cualquier respuesta que no sea 200 vuelve a consultar el registro (`GET …/safe-fixes/<id>`) y decide con `lifecycleState` y `proposalCommitSha`; no repitas a ciegas.**

Secuencia normal:
1. `POST …/safe-fixes` `{"priorityId":"<id del bloqueo>"}` → anota `record.id` y `record.reviewId` (análisis base). Estado final tras la llamada: `READY`; `proposalCommitSha: null`.
2. `{"action":"approve"}` → `APPROVED`.
3. El agente del cliente corrige y hace commit. Obtén el **SHA completo** (40 caracteres) del commit del cambio.
4. Espera a que el análisis en la nube de **ese** SHA esté `completed` con veredicto (`GET …/mission-control` → `productionVerdict.commitSha` = SHA).
5. `{"action":"applied","commitSha":"<SHA>"}` → 200 `binding: exact_proposal_commit`, estado `APPLIED`.
6. `{"action":"verify"}` → leer `verification.outcome`, `statement`, `verifiedCommitSha`, `verifiedScanId`.

Cómo interpretar `verify`:
| Resultado | Qué decir al cliente | Siguiente paso |
|---|---|---|
| `passed` + `statement: exact_commit_rescan_clean` | "El análisis completo del commit `<SHA>` ya no contiene este hallazgo" | Cerrado (`VERIFIED`) |
| `failed` + `target_still_present` | "En el commit `<SHA>` el hallazgo sigue presente" | `reopen` → nuevo cambio → nuevo SHA |
| `partial` (`verification_scan_missing`, `verdict_missing`, `engine_incomplete`, `insufficient_coverage`…) | "Todavía no hay evidencia suficiente de ese commit" (no es un fallo del arreglo) | Esperar el análisis → `reopen` → `approve` → `applied` (mismo SHA) → `verify` |
| `assisted_unbound` / `later_analysis_clean_unbound` (registro sin SHA) | "**Un análisis posterior** ya no contiene el hallazgo; no está ligado a un commit concreto" — **nunca** "parche verificado" | — |

### 4.1 Cambio de SHA: la aprobación se invalida y un 409 PUEDE haber modificado el registro
Si el registro está `APPROVED` con un SHA ya registrado y llamas `applied` con **otro** SHA:
1. La aprobación pertenecía al contenido anterior → el registro vuelve a **`READY`** y el **SHA nuevo queda guardado**.
2. Después la transición a `APPLIED` falla → la respuesta es **409 `invalid_transition:READY->APPLIED`**.
3. **Aunque sea un 409, el registro ya cambió.** Consúltalo: debe estar `READY` con el SHA nuevo. Entonces: `approve` → `applied` con el **mismo** SHA nuevo (ya no cambia nada) → `verify`.

Tabla de respuestas no-200 (¿pudo cambiar el registro?):
| Respuesta | ¿Cambió algo? | Acción |
|---|---|---|
| 400 `Invalid request body` (SHA mal formado) | No | Corregir el SHA (40 hex) |
| 409 `proposal_commit_is_base_commit` | No | Usar el commit del cambio, no el base |
| 409 `invalid_transition:READY->APPLIED` **con SHA distinto del registrado** | **Sí** (READY + SHA nuevo) | Consultar; `approve`; `applied` mismo SHA |
| 409 `invalid_transition:<estado>->APPLIED` con registro no `APPROVED` y un `commitSha` | No (se comprueba antes de escribir) | `approve` primero |
| 409 `proposal_commit_conflict` / `proposal_commit_locked` | **Posible** (puede haberse reabierto antes) | Consultar y decidir |
| 409 `invalid_transition:READY->READY` / `VERIFIED->READY` (`reopen` fuera de `FAILED`) | No | `reopen` solo desde `FAILED` |
| 503 `proposal_commit_unsupported` | No | La migración 067 no está aplicada |
`verify` solo debe llamarse con el registro en `APPLIED`: entonces devuelve 200 con `outcome` y lo deja en `VERIFIED` o `FAILED`. Si se llama en otro estado, la transición se rechaza antes de escribir nada y la API responde con un error de servidor (500, no capturado hoy; sin cambios en el registro): consulta el estado y sigue la secuencia.

Reglas: no verificar antes de que termine el análisis del SHA informado; no informar el SHA de otra rama; un registro solo se puede ligar a un SHA a la vez; para un cambio nuevo del cliente, nuevo SHA ⇒ repetir `approve` → `applied`.
Evidencia en cada paso: copia de la respuesta JSON y del `GET` posterior, con hora.

## 5. Estado de cada condición
Ver la tabla del informe de entrega (preparación del entorno de prueba vs. instalación del cliente).

# Piloto 12 de octubre — runbook de despliegue, E2E y comprobaciones manuales

Complementa `docs/PILOT_ONBOARDING_2026-10-12.md`. Nada de lo que sigue se ha ejecutado en producción: cada paso indica la autorización que necesita. La verificación de Safe Fix la hace el **equipo de SequrAI por API** (no hay interfaz).

Notación: `$APP` = `https://sequrai-app.vercel.app`; `$P` = id del proyecto `sequrai-e2e-test`; las llamadas necesitan la cookie de sesión de un miembro del workspace (`-H "Cookie: …"`). No se crean ni se rotan credenciales.

## 1. Despliegue (PR #57) — orden y recuperación

**Orden recomendado: migración → código.** El código también tolera desplegarse antes (ver §1.4).

1. **Antes** (autorización: aplicar migración en producción):
   - Snapshot/backup de la base de datos de producción y anotar su identificador.
   - `database/migrations/067_safe_fix_proposal_commit.sql` es **aditiva**: una columna nullable sin valor por defecto (cambio de metadatos, sin reescribir la tabla) y un `CHECK` que acepta NULL. Es idempotente (`add column if not exists`).
2. **Aplicar 067** en producción (SQL editor o `psql`). Comprobar:
   ```sql
   select column_name, data_type, is_nullable from information_schema.columns
   where table_schema='public' and table_name='safe_fix_records' and column_name='proposal_commit_sha';
   -- esperado: 1 fila, text, YES
   select count(*) filter (where proposal_commit_sha is null) as sin_sha, count(*) as total from public.safe_fix_records;
   -- esperado: sin_sha = total (ningún registro tiene SHA todavía)
   ```
3. **Fusionar #57** (autorización: fusionar) y esperar el despliegue de Producción. Comprobar que el SHA desplegado = SHA de fusión = `origin/main` (API de despliegues de GitHub, no solo el estado "merged").
4. **Si el código se desplegó antes que la migración:** leer registros funciona (columna ausente = documental/`assisted_unbound`). `POST …/safe-fixes/<id>` con `{"action":"applied","commitSha":"…"}` responde **503 `proposal_commit_unsupported`** sin cambiar nada; `applied` sin `commitSha` sigue funcionando. Aplicar 067 y repetir la llamada.

### Registros antes y después de la migración
| Registro | Comportamiento |
|---|---|
| Creado **antes** de 067 | `proposal_commit_sha = NULL`. Documental. Conserva su estado. Se verifica con el flujo asistido y se informa como `assisted_unbound` / `later_analysis_clean_unbound` (un análisis **posterior** ya no contiene el hallazgo; no es un parche verificado de un commit). |
| Creado **después**, sin commit informado | Igual que el anterior. |
| Con `commitSha` (vía `applied`) | Verificación exigiendo el análisis completo de **ese** commit exacto. |
| Ya `VERIFIED` (sin commit) al que luego se le informa un commit | Se reabre a `READY` (la verificación anterior no era sobre ese commit). |

### Comprobaciones posteriores (todas deben pasar)
1. `GET $APP/api/projects/$P/safe-fixes` → 200; los registros antiguos traen `"proposalCommitSha": null`.
2. `GET $APP/api/brain/project/$P` → 200 y `Cache-Control: private, no-store`; campos `verdictState` y `reviewInProgress` presentes.
3. `GET $APP/api/projects/$P/mission-control` y `…/protection-center` → 200 sin cambios de forma.
4. Ejecutar el E2E de §2.
5. Aislamiento: con una sesión de **otra organización**, `GET $APP/api/projects/$P/safe-fixes/<id>` y `POST` → 403/404, nunca 200 ni datos.

### Recuperación
- **Código:** redeploy del despliegue anterior (`6957962509`, SHA `889fb0ea…`) desde Vercel. El código anterior ignora la columna y no se rompe con ella presente.
- **Base de datos:** no hace falta revertir 067 para recuperar. Si hubiera que hacerlo: **antes** `\copy (select id, proposal_commit_sha from public.safe_fix_records where proposal_commit_sha is not null) to 'sha_backup.csv' csv`; luego `alter table public.safe_fix_records drop column proposal_commit_sha;` (no destruye registros; ensayado en `scripts/db-check-067.sh`). Tras eliminar la columna, los registros con commit pasan a verse como documentales (`assisted_unbound`); sus filas de `safe_fix_verifications` conservan `details.proposalCommitSha`/`verifiedCommitSha`.

### Prueba reproducible de la migración en una base de datos real
```bash
export PATH=/opt/homebrew/opt/postgresql@16/bin:$PATH   # PostgreSQL ≥ 14
./scripts/db-check-067.sh
```
Construye un clúster PostgreSQL temporal con `001–066`, y comprueba antes/después de 067 (22 comprobaciones: error 42703 sin columna, lecturas, escritura con guarda `is null`/`= sha`, escritura con alcance equivocado = 0 filas, `CHECK` de SHA, FK por organización, idempotencia, RLS, ensayo de rollback). Limitación: usa roles/`auth` simulados de Supabase y **no** pasa por PostgREST; el mapeo del error de columna ausente (`42703` / `PGRST204`) está probado con simulación en `safe-fix-migration-compat.test.ts`.

## 2. E2E reproducible en `sequrai-e2e-test`

**Autorización necesaria:** (a) #57 desplegada y 067 aplicada; (b) escribir **3 commits** en el repositorio de prueba (y revertirlos al final); (c) los análisis en la nube que disparen esos pushes. Solo `sequrai-e2e-test`; nunca otros proyectos.

Preparación: anotar `BASE` = SHA completo del último commit analizado y su `scanId`. El repositorio debe tener un hallazgo corregible por un cambio pequeño (p. ej. un secreto expuesto, detectado por el motor).

| # | Acción | Esperado |
|---|---|---|
| 1 | `POST /api/projects/$P/safe-fixes` `{"priorityId":"<id del bloqueo>"}` | 200 `{"result":{"status":"ready","record":{"id":"<F1>","lifecycleState":"READY","proposalCommitSha":null,…}}}` |
| 2 | `POST …/safe-fixes/<F1>` `{"action":"approve"}` | 200 `{"ok":true,"state":"APPROVED"}` |
| 3 | El agente (o una persona) aplica el cambio y hace **commit C1** a `main` → se dispara el análisis en la nube | — |
| 4 | `POST …/safe-fixes/<F1>` `{"action":"applied","commitSha":"<C1 completo>"}` | 200 `{"ok":true,"state":"APPLIED","binding":"exact_proposal_commit"}` |
| 5 | Verificar **antes** de que termine el análisis de C1 | 200, `verification.outcome` ≠ `passed`, `statement":"not_verified"`, razones incluyen `verification_scan_missing` (o `verdict_missing`); estado final `FAILED`, **no** `VERIFIED` |
| 6 | Esperar a que el análisis de C1 esté `completed` con veredicto persistido. Reabrir: `{"action":"reopen"}` → 200 `{"ok":true,"state":"READY"}`; repetir `{"action":"approve"}` y `{"action":"applied","commitSha":"<C1>"}` (mismo SHA: no cambia nada); y `{"action":"verify"}` | 200 `outcome:"passed"`, `binding:"exact_proposal_commit"`, `statement:"exact_commit_rescan_clean"`, `verifiedCommitSha == C1`; `GET …/<F1>` → `lifecycleState:"VERIFIED"`, `proposalCommitSha:"<C1>"` |

> **Comportamiento real observado (2026-10-09):** informar un `commitSha` **distinto** del ya registrado sobre un registro `APPROVED` invalida la aprobación (la aprobación era del contenido anterior): el registro vuelve a `READY`, el SHA nuevo queda guardado y la llamada responde **409 `invalid_transition:READY->APPLIED`**. Hay que repetir `approve` y luego `applied` con el mismo SHA. Es intencionado.
>
> El paso 5→6 prueba que **verificar antes** no aprueba nada. Una verificación que no puede concluir deja el registro en `FAILED`; `reopen` (solo válido desde `FAILED`, 409 en cualquier otro estado) lo devuelve a `READY` conservando el SHA registrado. Si se prefiere un solo ciclo, esperar el análisis antes del paso 4.

**Negativos (cada uno con una corrección nueva `F2`, `F3`, …):**

| Caso | Preparación | Esperado al verificar |
|---|---|---|
| Otro commit posterior que sí corrige | `F2` informada con `commitSha = C_sin_arreglo` (un commit que **no** corrige: p. ej. solo un comentario); luego `C2` corrige en `main` | Se evalúa el análisis de `C_sin_arreglo`, nunca `C2`: `outcome:"failed"`, razones `["target_still_present"]`; no `VERIFIED` |
| Análisis que todavía conserva el hallazgo | `F3` informada con un commit que mantiene el hallazgo | `outcome:"failed"`, `target_still_present`, `remainingTargetIds` no vacío |
| Commit de otro repositorio/rama | `commitSha` de un commit que no existe como análisis completado de este proyecto y rama | `outcome:"partial"`, `verification_scan_missing` |
| El commit informado es el base | `applied` con `commitSha = BASE` | 409 `proposal_commit_is_base_commit` |
| SHA mal formado | `commitSha:"abc123"` | 400 `Invalid request body` |
| Commit sobre registro no aprobado | `applied` con `commitSha` sobre un registro `READY` | 409 `invalid_transition:READY->APPLIED` |
| Sin `commitSha` (documental) | `applied` sin `commitSha`, luego `verify` tras un análisis posterior limpio | `binding:"assisted_unbound"`, `statement:"later_analysis_clean_unbound"`; **no** se presenta como parche verificado |

Limpieza: revertir los commits de prueba y dejar el repositorio en `BASE` (con autorización); conservar el registro de IDs de análisis y respuestas como evidencia.

## 3. SQL por concatenación omitido (alcance conocido; no se amplía el piloto)

- Reproductor: `lib/local-analysis/__tests__/known-gap-sql-concatenation.test.ts`.
- `db.query("SELECT … WHERE id = '" + id + "'")` **no** lo marca la regla nativa `injection.sql` (`features/security-scanner/rules/builtin.ts`): su literal es `["'][^"']*["']` y se detiene ante una comilla del otro tipo.
- Sí detecta `db.query("SELECT … WHERE id = " + id)` (control) y no marca la consulta parametrizada.
- La regla de taint de OpenGrep (`js-sql-injection-taint`) en la nube **podría** detectarlo; **no está verificado**.
- Mensaje al cliente: la cobertura de inyección SQL es parcial; el pilot no promete detección de esa familia. Cuando se arregle la regla, el `it.fails` del test se pondrá en rojo y habrá que convertirlo en un test normal.

## 4. Permisos de la GitHub App y evitar el OAuth legacy

Comprobado hoy (solo lectura) para la instalación del workspace de pruebas (`GET /api/github/app/status`): `status: active`, `repositorySelection: selected`, permisos `contents: read`, `metadata: read`, `pull_requests: read`, `checks: write`, `statuses: write`, `repository_hooks: write`. No hay escritura de código ni de PR. **Esto no prueba la instalación del cliente.**

Pasos para el cliente (autorización: acceder a su organización y a su instalación):
1. En GitHub → *Settings → Applications → Installed GitHub Apps → SequrAI → Configure*: confirmar **solo el repositorio del piloto** y los permisos de arriba (sin *Contents: write*, *Pull requests: write*, *Administration*).
2. Tras conectar, con la sesión del cliente: `GET $APP/api/github/app/status` → `installation.permissions` debe coincidir exactamente y `repositorySelection:"selected"`.
3. Confirmar que el proyecto usa la App: en la base de datos, `select github_auth_mode from projects where id='<id>'` → `github_app` (no `oauth_legacy`).
4. **No usar "Continuar con GitHub" para conectar repositorios**: el inicio de sesión OAuth heredado (`lib/github/oauth-client.ts`) solicita `repo admin:repo_hook` (lectura/escritura). Si el cliente ya inició sesión por OAuth, comprobar y, si existe un token con ese ámbito, pedir revocarlo en *GitHub → Settings → Applications → Authorized OAuth Apps*.
5. Registrar capturas de 1–2.

## 5. Checklist manual breve (persona con pestaña visible)

Requiere un navegador real, la pestaña en primer plano y una sesión del proyecto de prueba (autorización: iniciar un análisis).

- [ ] Abrir Mission Control y, en otra pestaña, Journey. Anotar el veredicto actual (escaneo `S0`).
- [ ] Pulsar "Revisar". **Mission Control (visible):** aparece "en curso"; no se muestra `S0` como decisión actual; progreso cada ~4 s.
- [ ] Mientras corre, **Journey** (recargar cada ~10 s): la postura dice "Análisis en curso — aún no hay decisión de seguridad final", **nunca** la postura de `S0`.
- [ ] Mientras corre: `curl -H "Cookie: …" $APP/api/brain/project/$P | jq '.brain | {verdictState, reviewInProgress, currentVerdict: .currentVerdict.scanId, ready: .productionReady.readyForProduction}'` → `historical_review_in_progress`, `reviewInProgress.scanId` ≠ `S0`, `ready:false`.
- [ ] Justo tras `completed` (primeros ~15 s): Journey y brain no presentan `S0` como actual (`pending_verdict` o `in_progress`); Mission Control `verdict_materializing` (atenuado) y sin verdict antiguo.
- [ ] Al llegar el veredicto nuevo: Mission Control y Journey convergen sin recargar (Journey: recargar); `verdictState:"current"`; el sondeo se detiene (red: sin peticiones a `/mission-control`).
- [ ] Repetir con la pestaña **en segundo plano** durante el análisis; al volver, converge en ≤ ~4 s (inmediato si pasaron > 60 s).
- [ ] Anotar hora de cada transición y adjuntar capturas.

## 6. Autorizaciones exactas que faltan

1. Fusionar #57 y #58. 2. Aplicar 067 en producción (con snapshot previo). 3. Desplegar. 4. Escribir 3 commits en el repositorio de `sequrai-e2e-test` y revertirlos. 5. Los análisis en la nube que esos pushes disparan. 6. Una sesión de **otra organización** de prueba ya existente para la comprobación de aislamiento (no se crean credenciales). 7. Una persona con navegador visible para §5. 8. Acceso (lectura) a la instalación de la GitHub App y al proyecto del cliente para §4.

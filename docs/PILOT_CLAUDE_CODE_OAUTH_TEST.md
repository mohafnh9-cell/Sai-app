# Prueba de OAuth mínimo desde Claude Code — configuración preparada (NADA APLICADO)

Estado: **preparado, sin aplicar**. Nada de lo que sigue se ha ejecutado en producción ni en la configuración real de esta máquina.
Alcance: esta prueba cuenta **solo para Claude Code**. Es distinta de la prueba del conector web de claude.ai (cliente `sequrai-claude-desktop`) y distinta de la integración con el entorno que use el cliente (A16, pendiente).
La **evidencia de protocolo** (PR #66, pruebas en memoria) no sustituye la **aceptación con un agente real**: esta.

## 1. Registro del cliente público (PR #67, migración 069)
| Campo | Valor |
|---|---|
| `client_id` | `sequrai-claude-code-pilot` |
| Tipo | `public` (sin secreto; PKCE S256 obligatorio) |
| Puerto fijo | `43871` (comprobar antes que está libre: `lsof -nP -iTCP:43871 -sTCP:LISTEN` no debe devolver nada) |
| Redirect URI exacta | `http://localhost:43871/callback` (la forma que envía Claude Code ≥ 2.1.231; comparación exacta de esquema, host, puerto y ruta) |
| Registro dinámico | **permanece deshabilitado** (`MCP_OAUTH_DCR_ENABLED` no se toca) |
| Política de ámbitos | **no cambia**: lo concedido lo decide el consentimiento; los 3 ámbitos sensibles son opt-in |

SQL exacto (el contenido de la migración, idempotente):
```sql
insert into public.mcp_oauth_clients (client_id, client_name, client_type, redirect_uris, status)
values ('sequrai-claude-code-pilot', 'Claude Code (pilot test, local)', 'public', array['http://localhost:43871/callback'], 'active')
on conflict (client_id) do nothing;
```
Comprobado en PostgreSQL real (cadena 001–069 aplicada dos veces): exactamente una fila nueva; los tres clientes existentes sin cambios.

## 2. Configuración de Claude Code (compatible con la versión instalada, 2.1.281)
Validada en un directorio de pruebas: la versión instalada la acepta y la interpreta ("OAuth: client_id configured, callback_port 43871").
```bash
cd /Users/mohamedfornah/Projects/sequrai-app
claude mcp add-json sequrai-pilot \
  '{"type":"http","url":"https://sequrai-app.vercel.app/api/mcp","oauth":{"clientId":"sequrai-claude-code-pilot","callbackPort":43871,"scopes":"mcp:status:read mcp:discover:read mcp:fix:read"}}' \
  --scope local
```
- `--scope local`: queda en la configuración privada del usuario para este proyecto (no se comparte, no hay aviso de aprobación, no se escribe en `.mcp.json`).
- `oauth.scopes` es la forma documentada de restringir lo que el cliente **solicita**: debe listar exactamente los tres ámbitos. No hay secreto: no se usa `--client-secret`.
- El nombre `sequrai-pilot` evita colisión con la entrada antigua `sequrai`.

## 3. Retirar SOLO la cabecera inválida del `.mcp.json` (conservando todo lo demás)
El `.mcp.json` actual contiene un único servidor, `sequrai`, con las claves `headers`, `type` y `url`. Mientras tenga `headers.Authorization` no puede usar OAuth. El comando elimina únicamente `headers` de esa entrada (sin imprimir su valor) y conserva cualquier otro servidor:
```bash
cd /Users/mohamedfornah/Projects/sequrai-app
python3 - <<'PY'
import json
p = '.mcp.json'
d = json.load(open(p))
entry = d['mcpServers']['sequrai']
had = entry.pop('headers', None) is not None
json.dump(d, open(p, 'w'), indent=2); open(p, 'a').write('\n')
print('removed sequrai.headers:', had, '| servers kept:', list(d['mcpServers']), '| sequrai keys now:', sorted(entry))
PY
```
Verificado sobre un archivo sintético con dos servidores: cambia solo `sequrai.headers`; `type`, `url` y el otro servidor quedan idénticos. Resultado esperado aquí: `servers kept: ['sequrai']`, `keys now: ['type', 'url']`. (Esa entrada seguirá sin servir para OAuth con Claude Code —no tiene `oauth.clientId`—; es opcional y se puede borrar entera con `claude mcp remove sequrai -s project`.) El archivo no está en `.gitignore`: no se debe subir a git.

## 4. Cómo se limita la autorización al workspace Sequrai
1. El token queda **atado al workspace activo del usuario en el momento de autorizar**: antes de conectar, selecciona **Sequrai** (nunca `test-ai-g7r2`).
2. La pantalla de consentimiento **muestra el nombre del workspace** (PR #68). Si no es "Sequrai": **Cancelar**.
3. Con `oauth.scopes` fijado, la pantalla debe listar **solo tres** capacidades (status, discover, fix), marcadas. Si lista seis, el cliente no respetó `scopes`: aceptar solo las tres marcadas por defecto o cancelar.
4. Después: lectura de **metadatos** del token de esta prueba (`organization_id`, `scopes`) para confirmar que el workspace es Sequrai y los ámbitos son exactamente los tres.
5. Las herramientas solo resuelven proyectos de esa organización (`resolveMcpProject`), y el cliente se retira al terminar (sección 7).

## 5. Escrituras exactas necesarias (todas requieren autorización expresa antes de ejecutarse)
| # | Dónde | Escritura | Cuándo |
|---|---|---|---|
| W1 | Repositorio | Fusionar #67 (migración 069) y #68 (nombre del workspace en el consentimiento); #66 (tests) opcional | antes de la prueba |
| W2 | Producción (despliegue) | Desplegar #68 | tras W1 |
| W3 | Base de datos de producción | Ejecutar `069` (el `insert` de la sección 1) | tras W2 |
| W4 | Esta máquina | `claude mcp add-json sequrai-pilot … --scope local` (sección 2) | antes de conectar |
| W5 | Esta máquina | Quitar `headers` del `.mcp.json` (sección 3), opcional | antes de conectar |
| W6 | Base de datos de producción | **Retirada** (sección 7) | al terminar |
| W7 | Esta máquina | `claude mcp remove sequrai-pilot -s local` | al terminar |
No se habilita registro dinámico, no se amplían ámbitos y no se tocan las claves heredadas.

## 6. Conexión y comprobaciones (después de W1–W4)
1. Reinicia la sesión de Claude Code en este proyecto (las herramientas nuevas se cargan al iniciar). Resumen para continuar: producción con #63 y #68, cliente `sequrai-claude-code-pilot` registrado, servidor local `sequrai-pilot` configurado.
2. En una terminal, `claude` en el directorio del proyecto → `/mcp` → `sequrai-pilot` → **Authenticate**. Se abre el navegador en la pantalla de consentimiento.
3. **Antes de aprobar**, comprueba y envíame: workspace mostrado, capacidades listadas y cuáles están marcadas, texto de Safe Fix ("guarda una propuesta persistente… no modifica tu código ni escribe en GitHub"). Aprueba solo con las tres marcadas por defecto.
4. `/mcp` debe mostrar `sequrai-pilot` **connected**.
5. **Ámbitos solicitados**: los listados en la pantalla (deben ser tres). **Concedidos**: lectura de metadatos (solo columnas no secretas):
```sql
select client_id, organization_id, scopes, created_at, expires_at, revoked_at
from public.mcp_oauth_access_tokens
where client_id = 'sequrai-claude-code-pilot' order by created_at desc limit 5;
select client_id, organization_id, scopes, family_id, expires_at, revoked_at
from public.mcp_oauth_refresh_tokens
where client_id = 'sequrai-claude-code-pilot' order by created_at desc limit 5;
```
Esperado: `organization_id` = Sequrai (`3635d73b-d1e7-4766-86dd-128529810637`) y `scopes = {mcp:status:read,mcp:discover:read,mcp:fix:read}` en ambas tablas. Nunca se selecciona `token_hash`.
6. **Rechazos — se leen del resultado de la herramienta, NO del código HTTP** (por JSON-RPC el rechazo llega como HTTP 200): llamar a `review_now`, `cancel_review`, `full_product_audit` y `authorize_dynamic_target` con un proyecto inexistente (`projectId: 00000000-0000-4000-8000-000000000000`). Aceptado solo si cada resultado trae `isError: true` y `code: "insufficient_scope"` con `data.requiredScope` (`mcp:review:run`, `mcp:review:run`, `mcp:audit:run`, `mcp:target:authorize`). Si alguno devuelve `project_not_found`, el control habría fallado (aun así no se habría ejecutado nada); no se amplían permisos para "hacerlo pasar".
7. **Herramientas permitidas**: `can_i_deploy`, `what_changed`, `production_history`, `discover_application`, `safe_fix` con el mismo proyecto inexistente deben llegar a la herramienta (`project_not_found`), **no** a `insufficient_scope`. Con el proyecto real, `safe_fix` crea (o reutiliza) una propuesta persistente: solo si se autoriza expresamente.
8. **Refresco**: cubierto por la prueba de protocolo (PR #66: mismos tres ámbitos, tokens rotados, reutilización revoca la familia). En la prueba real se observa de forma natural al caducar el acceso (1 h); no se espera para aceptar.

## 7. Retirada de la configuración de prueba
- `claude mcp remove sequrai-pilot -s local` (borra la configuración local y los tokens que Claude Code guardó).
- **En el servidor los tokens siguen válidos** (acceso 1 h, refresco 30 días) y no hay pantalla para revocarlos; la retirada completa es esta escritura (W6):
```sql
update public.mcp_oauth_refresh_tokens set revoked_at = now() where client_id = 'sequrai-claude-code-pilot' and revoked_at is null;
update public.mcp_oauth_access_tokens  set revoked_at = now() where client_id = 'sequrai-claude-code-pilot' and revoked_at is null;
update public.mcp_oauth_clients set status = 'disabled', updated_at = now() where client_id = 'sequrai-claude-code-pilot';
```
- Comprobar después: `select status from public.mcp_oauth_clients where client_id='sequrai-claude-code-pilot'` → `disabled`; ninguna fila con `revoked_at is null`.

## 8. Resultados observados (2026-10-09)
Separados por tipo de evidencia. Nada de esto es la prueba de claude.ai ni del entorno del cliente.

**Despliegue y registro.** PR #67, #68 y #66 fusionadas a mano (`6fe99cb`, `5b0d3bd`, `ee585c7`); producción sirve `ee585c7`. Migración 069 aplicada una sola vez (`INSERT 0 1`); los 3 clientes existentes con hash de fila idéntico antes y después. `/oauth/authorize` con el redirect exacto lleva a login; con otro puerto responde `invalid_redirect_uri`.

**Consentimiento** (observado por la persona, no por el agente): workspace Sequrai, solo las 3 capacidades previstas, texto de Safe Fix correcto.

**Conexión y ámbitos** (metadatos, sin secretos): un token de acceso (1 h, caduca 14:53 UTC) y un token de refresco (30 días), ambos con `client_id = sequrai-claude-code-pilot`, `organization_id = 3635d73b…` (Sequrai) y `scopes = {mcp:status:read, mcp:discover:read, mcp:fix:read}`; sin revocar. `claude mcp get`: cliente y puerto configurados.

**Rechazos** (proyecto inexistente `00000000-0000-4000-8000-000000000000`): `review_now`, `cancel_review`, `full_product_audit` y `authorize_dynamic_target` fallaron con "Insufficient scope for this tool" antes de resolver el proyecto. Límite: la interfaz de Claude Code solo muestra el texto del error; `isError`, `code: insufficient_scope` y `requiredScope` están verificados a nivel de protocolo en #66, no en esta ejecución. Control negativo: `can_i_deploy` con el mismo id respondió "No se encontró este proyecto en tu organización" (llega a la resolución del proyecto; no demuestra recorrido funcional).

**Herramientas permitidas sobre `sequrai-e2e-test`** (respuestas reales, commit `1eb0930`, escaneo `65e2b8db`, sin reanálisis): `can_i_deploy` → `ready_to_ship`, 100/100, 0 bloqueos, cobertura 8 de 12 áreas, recomendación `MORE_ANALYSIS_REQUIRED`, no obsoleto; `what_changed` → sin cambios (100 → 100); `production_history` → 34 revisiones, tendencia estable; `discover_application` → 0 tecnologías, confianza 20 %, 13 archivos.
- Observaciones: (a) el texto de `can_i_deploy` mezcla español e inglés y combina "Heads up — something needs attention" (alerta del 5 oct.) con "NO SE ENCONTRARON BLOQUEOS"; (b) aparece una alerta `deploy_blocked` creada a las 13:54:11 UTC aunque `can_i_deploy` se anuncia sin cómputo (no se ha determinado qué la creó); (c) `discover_application` persistió un informe de descubrimiento (`cached: false`); no es un escaneo.
- **`safe_fix` no se ejecutó:** el escaneo vigente solo tiene 3 hallazgos informativos y 0 bloqueos; no hay hallazgo elegible, así que el recorrido funcional (propuesta → commit → verificación exacta) **no está verificado** con un agente real.

**Conexión correcta ≠ recorrido funcional.** Verificado: autenticación, ámbitos concedidos, rechazo de 4 herramientas, lectura de 4 herramientas. Pendiente: `safe_fix` y el ciclo de corrección con un agente real, refresco (se observa a partir de las 14:53), y la integración del entorno del cliente (A16).

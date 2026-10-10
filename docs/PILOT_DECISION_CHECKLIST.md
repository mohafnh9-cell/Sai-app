# Piloto supervisado — checklist de decisión (11 de octubre)

Resumen breve y priorizado. El detalle y la evidencia están en `PILOT_SPRINT_CHECKLIST.md` (A/B) y `PILOT_CLAUDE_CODE_OAUTH_TEST.md`.
Estado a 2026-10-10. **El piloto no se declara completo mientras exista un bloqueo abierto.**

## 1. Bloqueos del piloto (cierran la decisión del 11)
| # | Criterio | Estado | Quién |
|---|---|---|---|
| K1 | Pruebas visuales: Mission Control, Journey, sondeo visible (primer plano y al volver de otra pestaña), dashboard/proyectos | **pendiente** (no sustituible por pruebas unitarias; Chrome automatizado reporta pestañas ocultas) | persona, guiada paso a paso |
| K2 | Aislamiento entre organizaciones con **dos sesiones reales** (sesión B: usuario real de otra organización no protegida, no miembro de Sequrai) | **pendiente** (hoy solo probado entre proyectos de la misma organización y con pruebas unitarias/PostgreSQL) | persona + agente |
| K3 | Recorrido MCP real con permisos mínimos | **aprobado para Claude Code** (3 ámbitos, 4 rechazos, ciclo creación → aprobación → aplicado con SHA → verificación exacta). Límites: refresco real **no probado**; `isError`/`code` no visibles en Claude Code (cubiertos por #66, protocolo) | — |
| K4 | Documentación coherente con lo observado y checklist única A/B | en curso (#65 abierta) | agente |

## 2. Condiciones de onboarding (12 de octubre; B = con la instalación del cliente)
- Un repositorio, solo rama por defecto, **una corrección asistida a la vez** (norma de procedimiento: el índice 068 limita una abierta por proyecto+recomendación, no por proyecto).
- OAuth con permisos mínimos; nunca claves `seq_live_…`. Cliente MCP del cliente **por decidir** (A16): su redirect URI debe registrarse como cliente público propio; sin registro dinámico.
- Los ids de recomendación son posicionales: confirmar el hallazgo antes de aplicar una propuesta (#64 añade la prueba que lo fija; abierta).
- B1–B8 (GitHub App del cliente, repositorio, primer análisis, MCP en su entorno) se hacen con el cliente; no se accede a su instalación antes.
- #69, #70 y #71 fusionadas (squash `26b267b`, `85dd084`, `7a6c821`) tras `verify` en verde; sin migraciones, scans ni nuevas autorizaciones OAuth.

## 3. Cambios desplegados el 2026-10-10 (producción sirve `7a6c821`, deployment 6977471896, `success`)
| PR | Qué corrige | Riesgo si no se despliega |
|---|---|---|
| #69 | `/oauth/authorize` y consentimiento no redirigen a un callback no validado ni de un cliente deshabilitado | bajo: solo viajan parámetros de error a la dirección indicada |
| #70 | `safe_fix` informa el estado persistido (READY) | bajo: la respuesta dice `PROPOSED` con `status: ready`; la base de datos es correcta |
| #71 | `can_i_deploy` no crea alertas; las evalúa el lote diario | medio: una consulta de solo lectura crea alertas visibles (medium, in-app, deduplicadas) |

## 4. Mejoras posteriores (no bloquean el piloto)
- Falso positivo `api.mass-assignment` en aserciones de respuesta de pruebas (conservar `tests/security-benchmark/**`).
- `introducedBlockers`: unidades y base distintas entre veredicto y estado de GitHub (1 frente a 22).
- Limitación SQL del motor cloud (límite documentado, aceptado; reproductor `known-gap-sql-concatenation.test.ts`).
- Revocación de tokens por el usuario (no hay pantalla; hoy solo escritura en base de datos) y refresco real observado.
- `resolveCanonicalDecisionState` escribe al leer (reparación del veredicto); texto de `can_i_deploy` mezcla idiomas con alertas históricas; `discover_application` persiste un informe.
- Descripción del consentimiento: declarar los efectos secundarios que queden.

## 5. Verificación posterior al despliegue (2026-10-10)
- **OAuth (solo GET, sin sesión, sin tokens nuevos):** URI externo con cliente activo → 400 JSON `invalid_redirect_uri`, sin `Location`; localhost con otro puerto → ídem; cliente deshabilitado con su URI anterior → 401 JSON `invalid_client`, sin `Location`; cliente desconocido → 401 JSON. Controles: cliente activo + URI registrado → 302 a `/login`; ámbito inválido con URI registrado → 302 al callback validado con `invalid_scope`. Recuentos de `mcp_oauth_*`: sin cambios (acceso 1, refresco 1, solicitudes 0, códigos 1).
- **Lote diario de alertas:** *comprobado:* ambas funciones (`alerts-daily-batch`, cron `30 7 * * *`, y `alerts-project-evaluate`) están registradas en `app/api/inngest/route.ts` del código desplegado; el lote creó alertas cada día a las ~07:30 UTC hasta el 8 de octubre (indirecto, por marcas de tiempo de `security_alerts`). *No comprobado:* el estado habilitado en el panel de Inngest (`/api/inngest` exige clave) ni **ninguna ejecución del paso nuevo** `evaluate-deploy-decision`; la próxima ejecución es hoy a las 07:30 UTC. Una ejecución no dejará fila nueva si la decisión ya tiene alerta (deduplicada); la evidencia es la salida del paso (`deployDecisionEvaluated`) en el historial de ejecuciones de Inngest.
- **Prueba intermitente preexistente:** `server/security-jobs/__tests__/worker-run-job.perf.bench.test.ts` (umbral de latencia 300 ms) falla de forma intermitente también en `ee585c7`, sin cambios en `security-jobs`.

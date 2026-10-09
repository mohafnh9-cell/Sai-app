# Piloto supervisado — guía de onboarding y criterios de incorporación (objetivo: 12 de octubre)

Estado: borrador para revisión. Cada afirmación indica su evidencia. Lo que **no** está comprobado está marcado como **PENDIENTE**.

## 1. Qué es el piloto (y qué no)

SequrAI **analiza, explica y verifica**. No escribe en el repositorio del cliente.

Flujo asistido:

1. **Conectar** el repositorio (GitHub App, solo lectura de código).
2. **Analizar**: un análisis por cada push a la rama por defecto, o manual desde Mission Control.
3. **Explicar**: el Veredicto de producción y sus hallazgos (qué se analizó, qué quedó fuera, qué hacer).
4. **Generar instrucciones**: Safe Fix (botón "copiar para Cursor" o la herramienta MCP `safe_fix`) devuelve instrucciones, no un parche.
5. **El agente del cliente aplica el cambio** y lo sube (commit).
6. **Reanalizar**: el push dispara un nuevo análisis.
7. **Verificar**: el hallazgo debe haber desaparecido en un análisis **completo** del commit del cambio.

Fuera del piloto: generación automática de parches, permisos de escritura en GitHub, apertura de PR, cola de PR, notificaciones automáticas.

## 2. Guía breve para el cliente

1. **Instalar la GitHub App** en el repositorio del piloto (solo ese repositorio). Permisos: Contents/Metadata/Pull requests **lectura**; Checks y Statuses escritura (para el check "SequrAI — Production Verdict"); Webhooks. No pedimos escritura de código ni de PR (`docs/GITHUB_APP_MIGRATION.md`).
2. **Esperar el primer análisis** (decenas de segundos en el repositorio de prueba). Mientras corre, Mission Control muestra "en curso" y **no** muestra el veredicto anterior como actual.
3. **Leer el veredicto**: solo "LISTO PARA DESPLEGAR" es una aprobación. "Sin bloqueos — evidencia limitada" **no** lo es. "Se necesita más análisis" significa que la evidencia no alcanza.
4. **Revisar la cobertura**: el desglose de áreas (evaluadas / parcialmente / no evaluadas) y el aviso de archivos omitidos indican qué quedó fuera.
5. **Corregir**: copiar las instrucciones de Safe Fix en su agente, aplicar el cambio, hacer commit y push.
6. **Verificar**: esperar el nuevo análisis; el hallazgo debe desaparecer. Para dejar constancia exacta del cambio, registrar el SHA del commit (ver §4, requiere PR #57 desplegada).

## 3. Estado verificado a 2026-10-09

| Área | Estado | Evidencia |
|---|---|---|
| Veredicto nunca presenta un veredicto anterior como actual (Protection, Mission Control con ámbito, brain) | Verificado en producción para un escaneo | Fase 8I.3.25: 303 muestras, 0 apariciones del veredicto anterior (PR #55, #56) |
| Journey durante el intervalo | **PENDIENTE** | No se pudo leer el DOM renderizado; ver §5 |
| Polling con pestaña visible | **PENDIENTE** | Las pestañas del entorno automatizado siempre reportan `hidden`; ver §5 |
| Brain durante un escaneo en curso | **PENDIENTE (conocido)** | Muestra el veredicto anterior mientras corre el escaneo; no hay campo de "en curso" |
| Aislamiento entre organizaciones/proyectos en Safe Fix | Implementado y probado localmente (PR #57, sin fusionar) | `safe-fix-isolation.test.ts` |
| Verificación atada al commit exacto | Implementado y probado localmente (PR #57, sin fusionar) | `safe-fix-commit-binding.test.ts` |
| Migración 067 | **No aplicada** | `database/migrations/067_safe_fix_proposal_commit.sql` |
| Recorrido completo con un cambio real en producción | **PENDIENTE** (depende de #57 + 067) | — |

## 4. Verificar con el commit exacto (tras desplegar PR #57)

`POST /api/projects/<id>/safe-fixes/<safeFixId>` con `{"action":"approve"}`, luego `{"action":"applied","commitSha":"<SHA completo de 40 caracteres>"}`, y cuando el análisis de ese commit haya terminado `{"action":"verify"}`. La verificación solo acepta el análisis completo de **ese** commit; un commit posterior no cuenta. Sin `commitSha` el registro queda como documental (`assisted_unbound`): no se presenta como parche verificado. **No existe todavía interfaz para este paso**; en el piloto lo hace el equipo de SequrAI.

## 5. Procedimiento manual pendiente (Journey y polling, pestaña visible)

Requiere un navegador real con la pestaña en primer plano y una sesión del proyecto de prueba (`sequrai-e2e-test`).

1. Abrir Mission Control del proyecto de prueba y, en otra pestaña, Journey. Anotar el veredicto actual.
2. Pulsar "Revisar" en Mission Control (pestaña visible). Observar: aparece "análisis en curso" y **no** el veredicto anterior como actual; el progreso se actualiza solo (cada ~4 s).
3. Al terminar, el veredicto nuevo aparece sin recargar; el sondeo se detiene (la pestaña de red deja de pedir `/mission-control`).
4. Repetir con la pestaña **en segundo plano** durante el análisis: al volver, debe converger en pocos segundos (≤ ~4 s por el intervalo; inmediato si pasaron >60 s).
5. Journey: durante y justo después del análisis, la postura debe leerse "Análisis en curso — aún no hay decisión de seguridad final" y nunca la postura anterior; recargar Journey tras terminar y comprobar que muestra el veredicto nuevo.
6. Registrar capturas y la hora de cada transición.

## 6. Criterios para incorporar al cliente el día 12 (todos deben cumplirse)

**Bloqueantes**
1. PR #57 revisada, fusionada y **desplegada**; migración 067 aplicada **con autorización** y verificada.
2. Prueba de aislamiento: dos organizaciones y dos proyectos; ninguna lectura ni escritura cruzada de Safe Fix en producción.
3. Recorrido completo en el repositorio de prueba con un **cambio real**: análisis → instrucciones → commit del agente → reanálisis → verificación atada a ese SHA → `VERIFIED`; y un caso negativo (commit posterior que no corrige) → no verificado.
4. Conexión **solo mediante GitHub App** con permisos de solo lectura de código. El inicio de sesión OAuth heredado solicita el ámbito `repo admin:repo_hook` (lectura y escritura de repositorios): **no** debe usarse para el cliente. Comprobar `github_auth_mode = github_app` y el `permissions` de la instalación.
5. Procedimiento de §5 ejecutado con pestaña visible, sin ver nunca un veredicto anterior como actual.
6. Ningún fallo abierto de aislamiento, verificación ni presentación de veredictos.

**Necesarios**
7. Errores de conexión visibles y accionables: instalación revocada, repositorio desconectado, token inválido (probar en el proyecto de prueba).
8. Análisis incompleto, veredicto pendiente y veredicto obsoleto (nuevo commit sin revisar) se muestran como tales; nunca como aprobación.
9. Cada hallazgo mostrado indica qué se analizó, qué queda fuera y qué debe hacer el cliente (hoy: cobertura y "Siguiente paso" existen; no hay interfaz de verificación de Safe Fix — §4).
10. Persona de contacto, canal de soporte, y forma de desconectar el repositorio y borrar sus datos, comunicadas al cliente.
11. El cliente entiende y acepta por escrito los límites: SequrAI no modifica su código; "evidencia limitada" no es aprobación; la cobertura no es total.

**Decisión**: si algún bloqueante (1–6) no se cumple a fecha 11 de octubre, el piloto se aplaza; la fecha es un objetivo, no un compromiso.

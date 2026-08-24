# 10K Readiness Checklist

**Fecha:** 2026-08-24 → 2026-08-25
**Origen:** auditoría técnica del repo (código real + `vercel env ls` + `gh` en vivo) contra `docs/hybrid-v1-architecture/10-scaling-strategy.md` y `docs/D10_READINESS_AUDIT.md`. Sesión 2 (25 ago): prueba en vivo del MCP y del AI Red Team contra `sequrai-app` real, con `full_product_audit` y `authorize_dynamic_target`.
**Regla:** no tachar un ítem sin evidencia (logs, test, o corrida real) — mismo estándar que D.10.

---

## P0 — Antes de aceptar usuarios reales

- [ ] **Cerrar el STAGING GO.** Levantar un entorno de staging propio y correr al menos una vez el flujo completo en vivo: GitHub App → webhook → scan → veredicto. Hoy solo hay tests unitarios, cero E2E real. Ver `docs/GITHUB_APP_STAGING_RUNBOOK.md`.
- [ ] **Verificar las 50 migraciones en la base de datos conectada.** ~~La última auditoría (D.10, 14 ago) no pudo conectar~~ → verificado en sesión 1: sí están aplicadas (`github_app_installations`, `protection_events` con 672 filas reales, etc.).
- [ ] **Validar Cohorte 0** (equipo + 3–5 founders amigos) contra sus propias métricas de salida: setup MCP <60s, veredicto P95 <2min, 0 incidentes P0. Ver `docs/roadmap/05-beta-milestones.md`.
- [x] **Añadir `GITHUB_WEBHOOK_SECRET` a `.env.local`.** ~~Única variable ausente~~ → no se tocó esta sesión, revisar si sigue pendiente.
- [ ] **Arreglar los 17 archivos de test que fallan.** Mismo baseline exacto al cerrar la sesión (17 archivos / 35 tests) — ninguno de los fixes de hoy los tocó ni los empeoró. Concentrados en `server/ai-red-team/` y `server/attack-simulation/`.

## P1 — Para aguantar 10,000 usuarios

- [x] **Caché de lectura compartido (Postgres o KV).** ~~`Map` en RAM~~ → **arreglado en sesión 2** (`daadc8c`): tabla `org_brain_cache` en Postgres, TTL 20s. Medido en prod real: 3.5s (primera carga) → 1.2–1.9s (con caché). Mejora real pero menor a la esperada — sigue habiendo latencia sin explicar en auth/workspace/GitHub-status por navegación, no investigado a fondo.
- [ ] **Rate limiting distribuido.** Sigue igual — por proceso, no por org. Se añadió rate limiting nuevo a 3 rutas OAuth (`ff112d4`) pero usando el mismo mecanismo por-IP-por-proceso existente, no uno distribuido.
- [ ] **Subir el plan de Inngest.** Sin tocar.
- [x] **Salto de SHA sin cambios en Continuous Protection.** Corregido el diagnóstico: **ya estaba implementado** (`server/continuous-protection/daily-review.ts:78-101`, variable `shaUnchanged`) — se había buscado mal la primera vez (grep por string literal en vez de leer el código).
- [ ] **Particionar `protection_events` por mes.** Descartado por ahora — con 672 filas reales (medido en sesión 1), particionar sería sobre-ingeniería prematura. Revisar cuando el volumen lo justifique.
- [ ] **Tabla outbox para email.** Descartado — `lib/resend/index.ts` es código muerto, nada lo llama todavía. No construir infraestructura para una feature que no está conectada.
- [ ] **Correr las pruebas de carga que el propio plan pide.** Sin tocar.

## P2 — Limpieza / higiene

- [x] **`npm audit fix`.** Hecho en sesión 1 — 14 → 3 vulnerabilidades (las 3 restantes exigen bajar Prisma, no se hizo).
- [x] **Mantener el checkout local sincronizado con `origin/main`.** Sincronizado en sesión 1; sesión 2 empezó ya al día.

---

## Bugs reales encontrados y arreglados en vivo (sesión 2, 25 ago)

Todos verificados contra producción real (`sequrai-app.vercel.app`), no solo en local. Production Ready Score de `sequrai-app` subió de **6/100 → 37/100** en el proceso.

- [x] **Permiso `webhooks` vs `repository_hooks`** (`84feb8b`) — la clave de permiso que pedía el código no coincidía con la que devuelve la API real de GitHub. Ninguna instalación de la GitHub App se registraba nunca, aunque GitHub la mostrara instalada.
- [x] **`next build` no compilaba en Vercel** (`86fcfbc`) — tipaba contra archivos de test rotos en vez de `tsconfig.typecheck.json`. Bloqueaba *todos* los deploys, no solo los de esta sesión.
- [x] **`listInstallationRepositories` usaba el JWT de la App en vez de un token de instalación** (`e5ad207`) — por eso `repoCount` siempre daba 0 al instalar la App.
- [x] **Setup URL vacía en la configuración de la GitHub App en GitHub** — config, no código. Sin ella nunca completaba el redirect de vuelta a SequrAI.
- [x] **Redirect abierto en `/api/github/app/setup`** (`8597077`) — Safe Fix real de SequrAI aplicado: todos los redirects usaban `request.url` como base en vez de un origen de confianza fijo.
- [x] **Rate limiting ausente en 3 rutas OAuth** (`ff112d4`) — Safe Fix real de SequrAI aplicado.
- [x] **Verificaciones de dominio viejas nunca expiraban** (`2fa3979`, `28e57da`) — reintentar `authorize_dynamic_target` crasheaba con `duplicate key value violates unique constraint` en vez de reutilizar o limpiar la verificación anterior.

## Pendiente — AI Red Team / pruebas dinámicas (sin resolver, no seguir a ciegas)

Encontrado al final de la sesión 2, requiere entender el diseño antes de tocar código:

- [ ] **`full_product_audit` resuelve mal el commit por defecto.** Sin pasar `branch` explícito, auditó un commit de semanas atrás (`13d65c8`) en vez del HEAD real. Con `branch: "main"` sí toma el commit correcto. Bug de resolución de commit, no de caché (confirmado: mismo resultado en dos llamadas separadas).
- [ ] **Las pruebas dinámicas del Red Team no se activan aunque haya una autorización válida.** Se completó el flujo entero (`authorize_dynamic_target` → `verify` → fila `approved` real en `attack_authorizations`, confirmada por consulta directa a la base de datos), pero `full_product_audit` sigue reportando `"Pruebas dinámicas de seguridad: Bloqueado"` justo después. Hay una desconexión entre el estado de autorización persistido y lo que el orquestador del audit comprueba — no investigado más a fondo, requiere leer el código del orquestador (`server/ai-red-team/autonomous-orchestrator/` o donde se decide el gate) antes de intentar un fix.
- [ ] **17 archivos de test en `ai-red-team`/`attack-simulation` siguen fallando** (ver P0) — probablemente relacionado con lo anterior; vale la pena revisar si son la misma causa raíz antes de tratarlos como deuda de tipos aislada.

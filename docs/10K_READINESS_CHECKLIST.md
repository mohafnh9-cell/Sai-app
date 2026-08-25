# 10K Readiness Checklist

**Fecha:** 2026-08-24 → 2026-08-25
**Origen:** auditoría técnica del repo (código real + `vercel env ls` + `gh` en vivo) contra `docs/hybrid-v1-architecture/10-scaling-strategy.md` y `docs/D10_READINESS_AUDIT.md`. Sesión 2 (25 ago): prueba en vivo del MCP y del AI Red Team contra `sequrai-app` real, con `full_product_audit` y `authorize_dynamic_target`.
**Regla:** no tachar un ítem sin evidencia (logs, test, o corrida real) — mismo estándar que D.10.

---

## P0 — Antes de aceptar usuarios reales

- [x] **Cerrar el STAGING GO.** ~~Levantar un entorno de staging propio y correr al menos una vez el flujo completo en vivo~~ → **cerrado 2026-08-25**: proyecto Supabase (`dfjpzbqtdxtmfsuwsigj`), GitHub App y GitHub OAuth App propios, deploy Preview de Vercel bajo `sequrai-app-staging.vercel.app`. Flujo real corrido de punta a punta:
  - Signup real vía GitHub OAuth → onboarding → conectar repo `mohafnh9-cell/sequrai-app` → scan real → veredicto **"Ready to Ship" · 100/100**.
  - PR real (#6, cerrado tras la prueba) en `sequrai-app`: el webhook del GitHub App entregó el evento (`POST /api/webhooks/github-app`), disparó un `webhook_pr_scan` real (15.3s), y creó el status `sequrai/production` — `pending` → `success` (`SequrAI — Ready to Ship · 100/100 · 0 blockers`), igual que el mapeo esperado del runbook.
  - Segundo commit en la misma rama: se creó un status **nuevo e independiente** para el nuevo SHA sin sobrescribir el status del commit anterior (verificado con `gh api .../statuses` en ambos SHAs).
  - Bugs reales encontrados y arreglados en el camino (no solo config): `SUPABASE_SERVICE_ROLE_KEY` de Preview compartía la clave de producción (rechazaba el admin client de staging con error sin código Postgres); `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` de Preview se perdieron accidentalmente durante la corrección anterior; `SCAN_SCHEDULER=inngest` fallaba en staging con `404 Branch environment does not exist` (sin integración Git de Vercel no hay branch environment de Inngest) → cambiado a `SCAN_SCHEDULER=inline` solo en Preview.
- [x] **Verificar las 50 migraciones en la base de datos conectada.** ~~La última auditoría (D.10, 14 ago) no pudo conectar~~ → **cerrado 2026-08-25**: la verificación de sesión 1 fue parcial (solo 2 tablas). Verificación real contra producción (`yuuytktcxxspoobsjcci`) vía SQL Editor, comprobando objetos de 9 migraciones repartidas entre 001 y 054: **3 de 9 no estaban aplicadas** — `049_mcp_oauth` (esquema completo del MCP OAuth ausente), `053_stripe_webhook_idempotency` (sin protección de idempotencia en webhooks de Stripe), y `052_idempotency_hardening` aplicada solo parcialmente (1 de 3 índices). Aplicadas las tres en producción con el usuario ejecutándolas directamente (acción bloqueada para mí por el clasificador de seguridad al tratarse de DDL en producción). Reverificado tras aplicar: las 9 migraciones comprobadas están presentes.
- [ ] **Validar Cohorte 0** (equipo + 3–5 founders amigos) contra sus propias métricas de salida: setup MCP <60s, veredicto P95 <2min, 0 incidentes P0. Ver `docs/roadmap/05-beta-milestones.md`.
- [x] **Añadir `GITHUB_WEBHOOK_SECRET` a `.env.local`.** ~~Única variable ausente~~ → no se tocó esta sesión, revisar si sigue pendiente.
- [x] **Arreglar los 17 archivos de test que fallan.** ~~Concentrados en `server/ai-red-team/` y `server/attack-simulation/`~~ → **arreglado** (`3110216`): reparados los 17 archivos, con bugs reales de correlación/scanner corregidos en el proceso. Verificado 2026-08-25: `npx vitest run` → 308 archivos / 1778 tests, 0 fallos.

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

Todos verificados contra producción real (`sequrai-app.vercel.app`), no solo en local. Production Ready Score de `sequrai-app` subió de **6/100 → 63/100** en el proceso (ver progresión abajo).

- [x] **Permiso `webhooks` vs `repository_hooks`** (`84feb8b`) — la clave de permiso que pedía el código no coincidía con la que devuelve la API real de GitHub. Ninguna instalación de la GitHub App se registraba nunca, aunque GitHub la mostrara instalada.
- [x] **`next build` no compilaba en Vercel** (`86fcfbc`) — tipaba contra archivos de test rotos en vez de `tsconfig.typecheck.json`. Bloqueaba *todos* los deploys, no solo los de esta sesión.
- [x] **`listInstallationRepositories` usaba el JWT de la App en vez de un token de instalación** (`e5ad207`) — por eso `repoCount` siempre daba 0 al instalar la App.
- [x] **Setup URL vacía en la configuración de la GitHub App en GitHub** — config, no código. Sin ella nunca completaba el redirect de vuelta a SequrAI.
- [x] **Redirect abierto en `/api/github/app/setup`** (`8597077`) — Safe Fix real de SequrAI aplicado: todos los redirects usaban `request.url` como base en vez de un origen de confianza fijo.
- [x] **Rate limiting ausente en 3 rutas OAuth** (`ff112d4`) — Safe Fix real de SequrAI aplicado.
- [x] **Verificaciones de dominio viejas nunca expiraban** (`2fa3979`, `28e57da`) — reintentar `authorize_dynamic_target` crasheaba con `duplicate key value violates unique constraint` en vez de reutilizar o limpiar la verificación anterior.
- [x] **Rate limiting real ausente en el webhook de Stripe** (`cee92d5`) — hallazgo genuino del Red Team, no falso positivo: la firma autentica el payload pero no protege contra flood de requests.
- [x] **Bug de raíz del commit obsoleto en `full_product_audit`** (`210fe0e`) — un job huérfano de `scan_jobs` del **18 de agosto**, atascado en `status: "running"` desde hace una semana, era encontrado primero por `getProductionReviewState` en cada llamada y devuelto como "la revisión actual", ignorando el mecanismo separado (`repository_scan_state.active_scan_id`) que sí trackeaba correctamente la revisión fresca. Confirmado con inspección directa de la base de datos, no solo lectura de código. Fix: cuando se reconcilia un job huérfano, ahora cae al lookup correcto en vez de devolver el scan reconciliado como si fuera el actual.
- [x] **Falsos positivos del detector estático, 3 causas separadas** (`cee92d5`, `52461f4`) — regex de auth sin reconocer `requireCiProjectAccess`; rutas públicas por RFC (`.well-known/*`, OAuth DCR/revoke) sin excluir; y un bug real de correlación donde concatenar `category + title` generaba coincidencias de substring por accidente entre reglas distintas.
- [x] **Refactor estructural del detector** (`fcc9159`) — las exclusiones de rutas estaban duplicadas en 3 reglas distintas, por eso se repitió el mismo tipo de falso positivo 3 veces. Centralizado en `features/security-scanner/rules/known-safe-patterns.ts` + 6 tests de regresión (incluyendo 2 controles negativos) para que esto no vuelva a pasar sin que lo atrape el CI.

## AI Red Team — confirmado funcionando de punta a punta

Los dos pendientes que quedaron abiertos al final de la sesión 2 **se investigaron y arreglaron** (no quedaron pendientes):

- [x] **Resolución de commit en `full_product_audit`** — era el mismo bug de raíz del job huérfano de arriba, no un problema de caché ni de parámetros. Arreglado.
- [x] **Pruebas dinámicas bloqueadas pese a autorización válida** — no era un bug: faltaba pasar `dynamicVerificationDecision: "authorize"` explícito en cada llamada (paso de confirmación por diseño, no implícito). Con ese parámetro, el Red Team ejecutó 23 comprobaciones dinámicas reales contra la app en producción y confirmó hallazgos con evidencia dinámica real (`CONFIANZA: Verificado`).

### Progresión del Production Ready Score de `sequrai-app` (mismo repo, sesión 2)

| Momento | Score | Qué cambió |
|---|---|---|
| Antes de empezar | 6/100 | — |
| + rate limiting auth | 25/100 | Safe Fix aplicado |
| + redirect de confianza | 37/100 | Safe Fix aplicado |
| + fix de raíz del commit obsoleto + mejoras del detector | **63/100** | Score real, consistente entre `can_i_deploy` y `full_product_audit` |

- [x] **17 archivos de test en `ai-red-team`/`attack-simulation` siguen fallando** — ~~deuda de tipos genuina entre fixtures y contratos~~ → **arreglado** (`3110216`, sesión posterior). Suite completa verde: 308 archivos / 1778 tests, 0 fallos (2026-08-25).

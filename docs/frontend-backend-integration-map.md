# Frontend ↔ Backend Integration Map

Phase 1 audit for the SEQURAI FRONTEND ↔ BACKEND INTEGRATION & MERGE initiative.
Scope: every tenant-scoped page/section a user can reach in `(dashboard)`, `/mcp`, `/integrations`, `/billing`.

## 1. Already real (verified this session / by direct code read)

| Area | Frontend | Backend source | Status |
|---|---|---|---|
| Dashboard KPIs (project count, needs-attention count) | `app/(dashboard)/dashboard/page.tsx` | `projects` table query + `getCachedOrgBrain` + `getLatestVerdictsByOrganization` | Real, tenant-scoped |
| Mission Control hero verdict | `features/mission-control/components/MissionControlHero.tsx` | `getProductionIntelligence` / `getProductionJourneyByProject` | Real |
| Dashboard verdict hero | `features/dashboard/components/ProductionControlCenter.tsx` | same verdict pipeline | Real |
| Scanner Results list | `app/(dashboard)/scanner-results/page.tsx` | `listScannerResultsForOrganization` | Real |
| Scanner Results detail (verdict, findings, reasoning, repo, previous analyses) | `app/(dashboard)/scanner-results/[scanId]/page.tsx` | `getScannerResultDetail`, `getProductionVerdictByScan`, `getFindingsForScanResult` (new, reads `scan_findings`), `listScannerResultsForOrganization` | Real |
| GitHub integration status/repos/webhooks | `app/(dashboard)/integrations/page.tsx` (client) | `/api/github/connection`, `/api/github/repos`, `/api/github/app/*`, `/api/github/webhook-health` | Real, fetched live, no mock |
| MCP API keys | `features/settings/McpApiKeysPanel.tsx` | `/api/mcp/keys` → `mcp_api_keys` table | Real. **P2 (pre-existing, not a mock issue):** client-side `useEffect` fetch instead of server-rendered — a data-fetching/perf nit, not fabricated data |
| Billing plan/status | `app/(dashboard)/billing/page.tsx` | `getOrganizationEntitlements(admin, organizationId, user)` | Real. Note: this reads the **uncommitted, unreviewed "entitlements" rewrite** already in the working tree (`server/billing/entitlements.ts`, `lib/billing/pro-plan.ts`). Not authored by me this session — flagged, not touched, not built upon further without separate review. |

## 2. Fabrication found (violates "no fake progress / no fake activity")

**`features/mission-control/lib/build-mission-control-view.ts`**

- Line 114: `input.sessionProgress ?? Math.min(95, 20 + index * 12)` — when a scan is in progress but the job hasn't yet reported real `meta.progress` (from `server/mission-control/get-mission-control.ts:288`), the UI synthesizes a fake per-team progress number from the team's array index, not from any backend signal.
- Line 124: synthetic `progressPercent: 55` for whichever team the fake progress math marks as "running".
- Line 174: `input.sessionProgress ?? (input.scanInProgress ? 42 : ...)` — fake overall-progress fallback (`42`).
- Line 221: `formatEta(input.sessionEtaSeconds ?? 102)` — fake 102s ETA fallback.
- `defaultFeed()` (line 265): uses `new Date().toISOString()` as the timestamp for generic status messages ("analysis initialized") when no real feed rows exist yet — acceptable as a "current state" label, but worth confirming with product that it should never be read as a historical event time.

**Real signal exists and should replace all of the above**: `meta.progress` / `meta.phase` / `meta.etaSeconds` from the scan job record already flow into `sessionProgress` / `sessionPhase` / `sessionEtaSeconds` in `server/mission-control/get-mission-control.ts`. The gap is only the moment right after a scan starts and before the job has written its first progress heartbeat — an "honest uncertainty" empty/indeterminate state (e.g. a pulsing/indeterminate progress bar with "Starting…" copy) is the correct fix, not a fabricated number.

## 3. Missing entirely (not mock — just not built)

- No MCP connection-status indicator anywhere on `/dashboard`. The master prompt's Phase 3 asks for one; there is currently zero UI for it. Needs a small real check (`mcp_api_keys` has at least one non-revoked row for the org) — trivial, no new backend needed.

## 4. Explicitly out of scope / do-not-touch this pass

- `server/billing/entitlements.ts`, `lib/billing/pro-plan.ts`, and the rest of the ~70-file uncommitted "entitlements" rewrite: pre-existing, unrelated, unreviewed work already in the working tree. Billing page already consumes it correctly for real data — no frontend changes needed there, and no further building on top of it without a dedicated review pass.

## 5. Recommended next steps (pending user confirmation before implementing)

1. Fix the mission-control progress/ETA fabrication (section 2) — replace fake numeric fallbacks with an honest indeterminate state.
2. Add a real MCP-connected badge to the dashboard (section 3).
3. No changes needed for GitHub integrations, billing, or scanner results — already real.

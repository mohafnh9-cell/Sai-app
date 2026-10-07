# Production Journey route (`/projects/:id/journey`)

**Status (Phase 8I.2): RESTORED. The route is a supported production surface (the "History" tab).**

## History of the decision

The route was permanently redirected to `/projects/:id` by `next.config.mjs` (added 2026-07-22, `872babc`, in one batch with `/timeline`, `/ai-fixes` and `/projects/:id/scans`). Repository evidence showed the redirect was accidental/obsolete:

- the page `app/(dashboard)/projects/[id]/journey/page.tsx` still exists and kept receiving changes after the redirect (run isolation `441e839`, `dc25886`; canonical posture, Phase 8I.1);
- the "History" tab (`ProjectWorkflowNav`, 2026-08-04/05), `MissionControlHistorySection` and `ProductionJourneyPreviewCard` were built after the redirect and link to it;
- `docs/BLOCK_6.5_REPORT.md` and `docs/COPY_GLOSSARY.md` describe Production Journey as a product feature;
- no commit or document records a deprecation.

Before the fix, clicking "Historial" landed on the project's Mission Control page. Phase 8I.2 removed only the `/projects/:id/journey` redirect. The other three legacy redirects are unchanged.

## What must stay true

The Journey must never communicate a deployment approval the canonical Production Verdict would not authorize (Phase 8I.1): maturity "Production Ready / Production Maintained" and the "Ready to Ship reached" milestone require canonical posture `ready`; LOW / evidence-limited, NOT_READY and an active scan can not produce them. See `brain/production-journey/{maturity,milestones,decision-display}.ts` and the tests under `brain/__tests__/production-journey-decision-language.test.ts` and `features/production-journey/__tests__/`.

`features/production-journey/__tests__/journey-route-status.test.ts` pins that the redirect stays removed and that navigation reaches the page.

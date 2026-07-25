# UX Sprint — Onboarding & First Five Minutes

**Sprint scope:** UX and onboarding only. **No new features.** Do not build Continuous Protection, Production Memory, alerts, monthly reports, or auto-remediation.

**Goal:** Sign up → GitHub → repo → first verdict → understand → Safe Fix → review again → Ready to Ship → MCP in **&lt; 5 minutes**.

**Feel:** Apple, Cursor, Stripe, Linear, Vercel — not AWS, Snyk, SonarQube, Datadog.

## Deliverables

| # | Document |
|---|----------|
| 1 | [UX Audit](./01-ux-audit.md) |
| 2 | [Onboarding Redesign](./02-onboarding-redesign.md) |
| 3 | [Safe Fix Redesign](./03-safe-fix-redesign.md) |
| 4 | [MCP Onboarding Redesign](./04-mcp-onboarding-redesign.md) |
| 5 | [Dashboard Redesign Proposal](./05-dashboard-redesign-proposal.md) |
| 6 | [User Journey Redesign](./06-user-journey-redesign.md) |
| 7 | [Remove, Hide, Simplify](./07-remove-hide-simplify.md) |

## Implementation rule

When engineering starts this sprint, changes are limited to:

- Copy, layout, flow order, navigation visibility
- Onboarding steps, CTAs, progress labels
- Safe Fix prominence and naming consistency
- MCP setup wizard (Settings + optional onboarding finale)
- Dashboard/project hero hierarchy

No backend feature work outside what existing APIs already support.

## Success metrics

| Metric | Target |
|--------|--------|
| First verdict | &lt; 2 min P95 |
| Ready to Ship (first GO or fix loop complete) | &lt; 5 min median (happy path) |
| MCP setup | &lt; 60 sec after shown |
| Confusion | Zero “what do I do?” in moderated tests (n ≥ 5) |

## One question per screen

Every screen must answer: **“What should I do next?”**

# SequrAI Visual Rebuild — Audit (Phase 0)

Read-only audit. No code changed while writing this document. Scope: the authenticated app shell and its four highest-traffic surfaces (Dashboard, Mission Control, Findings, AI Fix), cross-referenced against `~/AI-References/shadcn-ui`, `~/AI-References/arkite-ui`, `~/AI-References/aceternity-ui` (absent — see G), and the `ui-ux-pro-max` skill's own design judgment.

## A. Top 20 current visual problems (ranked by how much they contribute to the "amateur SaaS" read)

1. **`components/shared/PageHeader.tsx` already exists and is already used on 9 real pages** (Projects, 3 Settings pages, Admin, Integrations, Billing, both demo equivalents) — confirmed by grep, corrected after an initial wrong read of this audit. The real problem is narrower but still significant: **the two highest-traffic pages, Dashboard and Mission Control, don't use it** — `ProductionIntelligenceView.tsx`'s `<header>` and `app/(dashboard)/dashboard/page.tsx`'s greeting block are both bespoke, so the app's two most-viewed screens are exactly the ones with an inconsistent header treatment. `PageHeader` itself also only has a single `action` slot (no primary/secondary distinction) and reuses `text-display-headline` — the same class the Verdict hero headline uses — for a plain page title, which dilutes what that token is supposed to mean (see #6).
2. **Everything defaults to a card.** `RepositoryHealth`, `SecurityTimeline`, the Dashboard stats panel (added this session), `ProductionEngineerSummary`, `SafeFixHeroCard` — all `rounded-xl border bg-surface p-5/6`. A page with 6+ bordered boxes stacked vertically reads as a component gallery, not a composed product.
3. **No card-free secondary-metric pattern.** SequrAI has never used typography+whitespace alone to present a stat; every number gets a box. Compare Arkite's `Stat` component (`~/AI-References/arkite-ui/src/components/stat/Stat.tsx`), which is deliberately unboxed — `space-y-2`, no border, no background.
4. **Verdict score risks reading as a KPI dashboard.** `ProductionReadinessScore` is already correctly subordinated to the verdict headline (`size="secondary"`), but the surrounding page still stacks 4-5 more bordered panels below it with no visual signal that they're all in service of one decision.
5. **Radius inconsistency at the top of the hierarchy.** `IntelligenceSurface` (used by the Production Verdict hero and the Dashboard hero) uses `rounded-3xl` (`radius.xl`), while every other container in the app uses `rounded-xl`. One `rounded-3xl` surface among a sea of `rounded-xl` ones doesn't read as "premium hero" — it reads as inconsistent.
6. **Typography has only two real weights of emphasis.** `text-display-headline` (3xl/4xl) and everything else defaults to `text-sm`/`text-base`. There's no distinct "section title" step between a page's h1 and a card's h3 — `RepositoryHealth`'s `<h2>` and `SecurityTimeline`'s `<h2>` are both `text-sm font-semibold`, i.e., the same size as body text with a weight bump. Hierarchy exists almost entirely through boldness, not scale.
7. **Border opacity is chosen per-component, not from a system.** Grep for `border-border/` across `components/` and `features/` turns up `/40`, `/50`, `/60`, `/70`, and bare `border-border` — five different "how visible is this border" answers with no naming for any of them.
8. **Findings still show up to 3 badges per card** (severity, verification, diff-context) even after this session's demotion of category/status — severity is dominant now, but verification+diff-context are still full pill badges competing for the same visual slot.
9. **`components/ui/separator.tsx` and `components/ui/tabs.tsx` already exist (correct shadcn/Radix wrappers) but have zero real consumers anywhere in the app** (verified by grep). Sections are still divided with ad hoc `border-t border-border/40 pt-N` on individual elements, and the "Verdict / Attack simulation / History" page tabs are a bespoke `Link`-based nav — both primitives were built and then bypassed, not missing.
10. **Sidebar has no section grouping.** `PRIMARY_NAV` in `sidebar.tsx` is one flat list (Dashboard, Projects, Integrations, Cursor/MCP, Settings) — no "Workspace / Security / System" grouping the way a mature security tool's IA would communicate priority.
11. **Dashboard's `ProductionControlCenter` and Mission Control's `MissionControlHero` are two different visual treatments of the same underlying question** ("can I deploy?") — one is a bespoke `IntelligenceSurface`-based card with its own copy, the other renders through `components/sequrai/ProductionVerdictCard`. A user moving between the two pages sees the verdict presented two different ways.
12. **No formalized elevation scale beyond flat vs. `shadow-premium`/`shadow-premium-lg`.** Nothing currently documents when a component should reach for which — usage is inconsistent (most cards use neither, a few reach for `shadow-premium-lg` inconsistently).
13. **Metadata rows (last-analyzed, commit sha, file counts) don't share a typographic treatment.** Some use `text-xs text-muted-foreground`, some use `.text-label-caps`, some are inline with body text — no single "this is metadata, not content" signal.
14. **`Badge` primitive doesn't express the app's own severity vocabulary.** `components/ui/badge.tsx` only knows `default/secondary/destructive/outline` — every severity/verification/verdict badge in the app bypasses it and hand-rolls its own class string, which is why five different badge-shaped components exist (`SecuritySeverityBadge`, `VerificationStatusBadge`, `DiffContextBadge`, `VerdictStatusBadge`, `ConfidenceLevelBadge`).
15. **No `Accordion` primitive** (`@radix-ui/react-accordion` is already a dependency, but `components/ui/accordion.tsx` doesn't exist) — `EvidencePanel` and `CollapsibleSection` both hand-roll `<details>`-based disclosure independently rather than sharing one primitive. `Tabs` doesn't have this excuse — the wrapper exists (see #9) and is simply unused.
16. **The MCP promo banner, activity banners, and recovery banners are all bespoke, differently-styled inline alert boxes** — no shared `Alert` component, so "something needs your attention" looks different depending on which banner is showing.
17. **Numbers aren't consistently `tabular-nums`.** The Verdict score and a handful of stat displays use it; `RepositoryHealth`'s per-area scores and the new Dashboard stats panel do not.
18. **Empty vertical rhythm is uniform regardless of content importance.** `space-y-8`/`space-y-12` is applied flatly down a page — the gap between the Verdict card and the next section is visually identical to the gap between two minor utility sections, so nothing signals "this is the important part."
19. **The Findings filter toolbar and the Verdict page's own header both reinvent "row of controls," slightly differently** — no shared toolbar pattern.
20. **`PageHeader`'s single `action` slot can't express "primary action / secondary action"** — pages that need two (e.g., Mission Control's implicit "scan" + "view report" actions) can't use it as-is even where it would otherwise fit, which is part of why Mission Control never adopted it.

## B. Repeated patterns (the "assembled from parts" tell)

- `card → card → card`: Mission Control alone stacks 7 bordered surfaces vertically (Verdict, What Changed, Top Risks, Safe Fix, Repository Health, Security Timeline, plus the collapsed Full Report).
- `badge → badge → badge`: up to 3 pill badges per finding card, plus category/status now demoted to text (this session) but still visually "one more label" territory.
- Ad hoc `border-t border-border/NN pt-N` used as a poor man's `<Separator>` in `RecommendedAction`, `ProductionEngineerSummary`, `CopySafeFixPromptButton`'s wrapper, `SafeFixHeroCard`.
- `rounded-xl border bg-surface p-5` (or `p-6`) copy-pasted as the default "I am a section" wrapper across `RepositoryHealth`, `SecurityTimeline`, the new Dashboard stats panel, `ProductionEngineerSummary`.
- Every page's title block is `<p className="text-eyebrow">…</p>` + `<h1/h2 className="text-2xl sm:text-3xl font-semibold">…</h1>` + a metadata line — written out fresh each time instead of one component.

## C. Components that should evolve

- `SecurityFindingCard` — keep its data model and hierarchy (already correct from prior checkpoints), but its badge row still needs the verification/diff-context demotion pass.
- `RepositoryHealth` / `SecurityTimeline` — candidates to lose their card wrapper in favor of a shared section pattern with a divider, not a border.
- `components/shared/PageHeader.tsx` — extend with an optional `secondaryAction` slot, then wire Dashboard and Mission Control onto it (the only two primary pages not already using it) instead of leaving their bespoke header blocks in place.
- The 5 badge-shaped components (`SecuritySeverityBadge`, `VerificationStatusBadge`, `DiffContextBadge`, `VerdictStatusBadge`, `ConfidenceLevelBadge`) — should all route through one extended `Badge` primitive that knows the app's semantic tones, rather than each hand-rolling `severityBadgeClass`-style functions independently.
- Sidebar nav — should gain section grouping (Workspace / Security / System) matching the brief's own proposed IA.

## D. Components that should be kept as-is

- `IntelligenceSurface` and the Production Verdict hierarchy (badge → headline → score → why → blocker → action) — already correct, product of two earlier approved checkpoints. Don't re-litigate.
- `EvidencePanel`'s progressive disclosure *mechanism* (closed by default, confidence/verification in the summary row) — correct behavior, needs a primitive swap (→ shadcn Collapsible pattern) not a redesign.
- `CopySafeFixPromptButton` — functionality, analytics, and copy behavior are approved and must not change.
- The Sheet-based mobile drawer (Phase 1 of this whole effort) — correct, keep.
- The wide-container fix from the Structural Pass — correct, keep.

## E. shadcn patterns studied (exact files)

- `~/AI-References/shadcn-ui/apps/v4/registry/bases/radix/ui/card.tsx` — `CardHeader`'s grid composition (`grid-cols-[1fr_auto]` when an action slot is present) — a clean "title/meta left, action right" pattern worth adapting for finding cards' header row.
- `~/AI-References/shadcn-ui/apps/v4/examples/aria/collapsible-demo.tsx` and sibling collapsible examples — confirms the disclosure interaction model SequrAI's own hand-rolled `<details>` already approximates; the gap is a shared primitive, not the interaction pattern itself.

## F. Arkite patterns studied (exact files)

- `~/AI-References/arkite-ui/src/components/stat/Stat.tsx` — unboxed metric display (label row + value + optional trend, `space-y-2`, no border/background). Direct reference for de-carding secondary numbers app-wide.
- `~/AI-References/arkite-ui/src/components/page-header/PageHeader.tsx` — title/description/breadcrumb/badge/actions composition with 3 explicit size scales (`sm`/`md`/`lg`). Direct reference for the missing shared `PageHeader`.
- `~/AI-References/arkite-ui/src/components/filter-bar/FilterBar.tsx` — already adapted in the prior Findings checkpoint (single responsive toolbar row).
- `~/AI-References/arkite-ui/src/components/badge/Badge.tsx` — the muted `count` variant already adapted in the prior Findings checkpoint for demoted metadata.
- `~/AI-References/arkite-ui/src/components/table/Table.tsx` — density convention (`data-compact` → `px-3 py-2`) referenced, not adopted wholesale (findings are card-shaped, not tabular).
- `~/AI-References/arkite-ui/src/components/sidebar/Sidebar.tsx` — exists, not yet inspected in full; flagged for the shell-rebuild pass.

## G. Aceternity patterns studied

`~/AI-References/aceternity-ui` does not exist on this machine (only `shadcn-ui` and `arkite-ui` are present under `~/AI-References/`). **NONE — deliberately rejected** on top of that: nothing in this audit's scope (dense data surfaces, a verdict decision, a findings list) calls for a decorative reveal interaction. Consistent with every prior checkpoint this session.

## H. UI/UX Pro Max decisions carried into this audit

- "Data-Dense Dashboard × Swiss Modernism" direction (established in the first frontend audit this session) — this document's recommendations (de-card secondary content, use typography/whitespace over borders, one dominant focal point) are a direct application of that direction, not a new one.
- Rejected again: any of the skill's "AI SaaS" / neon / HUD defaults — consistent with every checkpoint so far.

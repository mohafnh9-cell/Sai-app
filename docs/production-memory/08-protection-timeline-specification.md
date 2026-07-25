# Protection Timeline Specification

**Definition:** The **chronological story** of protection — curated events rendered for humans, not a developer log.

**Founder question answered:** *What happened to my app while I was building?*

---

## 30-second comprehension (headline block)

**Primary UI pattern** — above fold in Protection Center, not a scrollable Jira feed.

```
Continuously protected for 143 days

• 17 unsafe deployments prevented
• 4 critical issues fixed
• Production confidence up 23% since you started
• Security confidence up 18%
• Currently: PROTECTED
```

**Rules:**

- All numbers from `project_memory_profile` + snapshot first/last — **single recompute job** nightly to avoid drift.  
- Tenure pauses honestly when CP off (*"Protected 143 of last 150 days"* if gap).  
- Max **5 bullets** + status word.  
- Investor mode: same block in monthly PDF cover.

**This is not analytics** — it is **protection proof**.

---

## Timeline vs raw Project Memory

| | Project Memory | Protection Timeline |
|---|----------------|---------------------|
| Audience | Systems, MCP formatters | Founders, co-founders, investors |
| Granularity | Every event | **Merged episodes** + highlights |
| Silent daily checks | Logged | **Hidden** unless material |
| CVE IDs | Never shown | Never shown |

---

## Episode merging rules

Combine within **2 hours** same `scanJobId`:

- `protection_review_started` + `protection_review_completed` + `verdict_created` → **one** timeline row: *Protection review completed*

Combine same day silent dailies:

- Multiple `continuous_check_completed` → **one** weekly rollup line, not 7 rows

Always show standalone:

- `material_change_detected`
- `deploy_blocked`
- `fix_verified`
- `protection_paused` / `protection_resumed`
- `protection_status_updated` (when status changes)

---

## Timeline row schema (presentation layer)

| Field | Example |
|-------|---------|
| `occurredAt` | Mar 14, 2026 |
| `icon` | review / alert / deploy / fix / watch |
| `titlePlain` | *Rate limiting fix verified* |
| `subtitlePlain` | *Production confidence 91% → 97%* |
| `cta` | Optional: Safe Fix, View weekly |

---

## Default views

### Timeline lite (Protection Center)

Last **10** episodes, below fold.

### Timeline full (future tab or “See all”)

Paginated 30 days → 90 days → 12 months.

### Investor / monthly mode

Auto-generated from monthly job — not interactive timeline.

---

## Event → copy templates

| Source type | Title template |
|-------------|------------------|
| `verdict_created` + GO | *Review complete — comfortable to deploy* |
| `verdict_created` + NO-GO | *Review complete — I would not deploy yet* |
| `deploy_blocked` | *Deploy check: not ready* |
| `material_change_detected` | *Something changed — needs attention* |
| `fix_verified` | *Fix verified: {titlePlain}* |
| `protection_paused` | *Continuous protection paused* |
| `weekly_summary_generated` | *Your week with SequrAI* |

---

## What should never appear on timeline

- Internal job failure stack traces
- `alert_sent` duplicates (merge into material change)
- Raw dependency advisory IDs
- Behaviour rule IDs (show summaryPlain only)

---

## Founder experience

Timeline answers **story**, not **audit**:

> *Mar 1 — First protection review*  
> *Mar 8 — Fix verified on auth*  
> *Mar 10 — Deploy check: not ready (rate limit)*  
> *Mar 14 — Daily watch: all clear*

---

## MCP

Timeline **feeds** `production_history` narrative — MCP does not dump 50 rows.

| User | Tool | Timeline use |
|------|------|--------------|
| Tell me the story of this project | `production_history` | Top 5 episodes + trend |
| What happened last week? | `production_history` | Episodes in 7d window |
| What changed? | `what_changed` | Diff-focused, not full timeline |

---

## Daily / weekly / monthly

| Cadence | Timeline |
|---------|----------|
| Daily | Material only |
| Weekly | Inject `weekly_summary_generated` episode |
| Monthly | Archive snapshot PDF + link from timeline |

---

## Acceptance criteria

- Lite timeline loads &lt; 200ms from snapshot + 10 events query.
- Silent week shows at most one “Watching continued” rollup or none.
- Timeline copy passes glossary lint (Protection not Scan).

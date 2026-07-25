# Production Confidence History Specification

**Definition:** Time series of **“Would I deploy this today?”** confidence — distinct from security exposure and composite health.

**Founder question answered:** *Is my production readiness getting better or worse?*

---

## What should be stored

### Point samples

Each sample:

| Field | Source |
|-------|--------|
| `date` | Calendar date (project TZ for display; UTC bucket for storage) |
| `productionConfidence` | 0–100 integer from verdict engine |
| `deployAnswer` | GO / NO-GO / NOT YET at sample time |
| `verdictId` | Optional link |
| `source` | `verdict` \| `daily_snapshot` \| `deploy_check` |

### Event sources

| Event | Writes sample? |
|-------|----------------|
| `verdict_created` | Yes — authoritative |
| `confidence_snapshot` | Yes — daily when CP ON |
| `deploy_readiness_checked` | Optional point (if different from cached verdict) — prefer not to duplicate same day |

**Rule:** At most **one canonical daily point** per project per day on `protection_snapshots` table; intraday MCP checks may append events but charts use daily rollup.

---

## What should never be stored

- Fabricated confidence when no verdict exists
- Confidence from other tenants or benchmark apps
- Hidden “penalty” fields not explainable in `what_changed`

---

## Derived narratives (not stored separately)

Computed at read time for MCP/dashboard:

| Derivation | Rule |
|------------|------|
| 7-day delta | `today - 7d ago` |
| 30-day delta | Same |
| Trend label | ↑ if delta ≥ +3, ↓ if ≤ -3, else → |
| “Best in 90d” | max in window — for celebration copy only |

---

## Founder experience

### Protection Center

- Sparkline default: **production confidence**, 30 days
- Annotation markers on `material_change_detected` dates

### Copy

```
Production confidence: 97% (↑ over 7 days)
```

Not:

```
Production score: 97
```

---

## MCP (`production_history`)

Lead with direction when user asks improvement/health:

```
Production confidence went from 81% to 97% over the last 30 days.

What helped:
• Fix verified on rate limiting (Mar 8)
• No new material changes this week
```

Pair with `what_changed` if user asks *why* drop.

---

## Daily / weekly / monthly

| Cadence | Update |
|---------|--------|
| Daily | Snapshot row after CP or carry forward if unchanged (store same value + `unchanged: true` in payload optional) |
| Weekly | Start/end values in `weekly_summary_generated` |
| Monthly | Opening/closing confidence in monthly report |

---

## Relationship to other histories

| Metric | Overlap |
|--------|---------|
| Security confidence | Same dates, different column — doc 05 |
| Project health | Weighted composite — doc 07 |
| Protection status | Qualitative; can diverge when deploy NOT YET but PROTECTED |

---

## Acceptance criteria

- Chart matches latest `verdict_created` on day of review.
- MCP and Protection Center show identical integer for same `snapshotDate`.
- Missing days in CP outage show gap in sparkline — not interpolated fiction.

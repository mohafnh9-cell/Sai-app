# Production Health Specification

**Purpose:** Quantify **trust** for founders who want a number — without becoming a scanner scoreboard. **We sell trust.**

---

## Concepts (three related metrics)

| Metric | Question it answers | Where shown |
|--------|---------------------|-------------|
| **Production Health Score** | How healthy is the **project** overall? | Protection Center, weekly |
| **Production Confidence** | Would I deploy **today**? | MCP deploy answers, hero |
| **Security Confidence** | How comfortable am I with **exposure**? | MCP, Protection Center secondary |

**Protection Health** (V1): qualitative band derived from **Protection Status** (doc 04), not a fourth 0–100 score.

| Protection Health | Maps from status |
|-------------------|------------------|
| Strong | PROTECTED |
| Steady | SAFE WITH CAUTION |
| At risk | REQUIRES ATTENTION |
| Unwatched | NOT PROTECTED |

---

## Production Health Score (0–100)

Composite updated on every completed review and daily snapshot.

### Inputs (Hybrid V1 weights)

| Factor | Weight | Source |
|--------|--------|--------|
| Latest security confidence | 35% | Verdict |
| Latest production confidence | 35% | Verdict |
| Recency of successful check (&lt; 7 days = full credit) | 15% | Memory |
| Open critical/high finding pressure | 15% | Findings model |

### Labels (user-facing)

| Score band | Label | Copy |
|------------|-------|------|
| 85–100 | **Excellent** | *Your application is in strong shape.* |
| 70–84 | **Good** | *Healthy — a few improvements would help.* |
| 50–69 | **Needs attention** | *I'd address the top worry this week.* |
| 0–49 | **At risk** | *I would not rely on this state in production.* |

**Rule:** Label never contradicts Protection Status headline — if status is REQUIRES ATTENTION, health label caps at **Needs attention** even if math says Excellent.

---

## Confidence trends

### Storage

Daily snapshot in Memory: `{ date, productionConfidence, securityConfidence, healthScore, healthLabel, protectionStatus }`.

### Visualization (Protection Center)

- **Sparkline:** 30-day production confidence (default)
- **Toggle:** security confidence
- **Annotation:** markers on material_change_detected (hover: one-line why)

### Trend semantics

| Pattern | Narrative |
|---------|-----------|
| ↑ both 7d | *Production confidence is increasing — nice work.* |
| ↓ either ≥10 | *Something eroded trust this week — see what changed.* |
| Flat high | *Steady week. Nothing material moved.* |
| Flat low | *You're stuck — Safe Fix on {x} is the unlock.* |

---

## Open issues (founder language)

Do **not** expose “open findings count” as hero.

**“Things I'm still watching”** (max 3):

- Linked to recommendation / Safe Fix
- Severity internal only

When zero:

> *Nothing open that would stop me from protecting this app.*

---

## Project evolution

**Evolution** = Memory-backed story over time:

| Dimension | MCP tool | Dashboard |
|-----------|----------|-----------|
| Confidence over 30/90 days | `production_history` | Sparklines |
| Status transitions | `production_history` | Timeline lite |
| Week-over-week delta | `what_changed` | Weekly card |
| Deploy checks logged | `production_history` | Optional timeline event |

---

## MCP responses

### “How healthy is my application?”

**Sequence:** `production_history` (trend) + optional `can_i_deploy` (now)

Template:

```
Production health: {Excellent|Good|Needs attention|At risk}

Production confidence: {n}% ({trend 7d})
Security confidence: {n}% ({trend 7d})

What worries me:
• {max 3}

Recommendation:
{one action}
```

### “Is production confidence increasing or decreasing?”

**Tool:** `production_history`  
Lead with direction, then cause if `what_changed` diff available in same turn (host may bundle).

---

## What we deliberately omit (V1)

- Infrastructure uptime
- Error rates from production logs
- P99 latency
- “Industry benchmark percentile”

Those belong in **Future Architecture** backlog unless promoted.

---

## Acceptance criteria

- Health score reproducible from fixture verdict + Memory dates.
- Trend arrows match numeric delta (no “up” when score dropped).
- MCP and Protection Center show **same** confidence integers for same snapshot timestamp.
- Copy glossary aligned with [COPY_GLOSSARY.md](../COPY_GLOSSARY.md) and MCP doc 06.

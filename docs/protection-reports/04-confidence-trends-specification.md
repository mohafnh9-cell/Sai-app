# Confidence Trends in Reports Specification

**Purpose:** Show **direction of trust** in weekly and monthly artifacts — not chart junk.

Data model: [../production-memory/04-production-confidence-history-specification.md](../production-memory/04-production-confidence-history-specification.md), [05](../production-memory/05-security-confidence-history-specification.md).

---

## Metrics displayed

| Metric | Weekly | Monthly |
|--------|--------|---------|
| Production confidence start → end | ✓ | ✓ |
| Security confidence start → end | ✓ | ✓ |
| Production health label | End only | End + start if changed |
| Trend arrow | 7d | 30d |
| Sparkline | Optional mini (7 points) | 30 points in PDF |

**Never:** CVSS, CVE trend lines, “industry benchmark.”

---

## Trend rules

| Delta (production or security) | Arrow | Copy helper |
|--------------------------------|-------|-------------|
| ≥ +3 | ↑ | *improved* |
| ≤ −3 | ↓ | *eroded* |
| else | → | *held steady* |

If production ↑ and security ↓:

> *Production readiness improved, but exposure worries me more than last {week|month} — read worries below.*

---

## “What improved?” linkage

Confidence **↑** alone is not “improved” without cause:

| Improved story | Evidence in report |
|----------------|-------------------|
| Fix verified | `fix_verified` event title + date |
| Attack surface down | Snapshot delta |
| Quiet stability | No material alerts + checks 100% |

List **human wins** before numbers in monthly “What improved” section.

---

## Charts (UX)

### Weekly in-app

- Micro sparkline: 7 daily production confidence points  
- Tap toggles security (mobile)  

### Monthly PDF/email

- Dual line or side-by-side numbers + small chart  
- Accessible: table fallback in HTML  

---

## Divergence callout

When deploy answer NOT YET but confidence high:

> *Confidence is strong, but I wouldn't deploy yet because of {worry}.*

Reports must not contradict MCP deploy answer at same snapshot.

---

## MCP

| User | Tool | Output |
|------|------|--------|
| Am I improving? | `production_history` | Same arrows as monthly |
| Why did confidence drop? | `what_changed` | Causal bullets |

Weekly/monthly reports **precompute** the same strings MCP would generate — no second math.

---

## Acceptance criteria

- Start/end values match Memory snapshots on boundary dates.  
- Arrow direction matches numeric delta sign.  
- Reports never show confidence without production **and** security pair in monthly.

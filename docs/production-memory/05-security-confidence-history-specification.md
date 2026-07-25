# Security Confidence History Specification

**Definition:** Time series of **exposure and security posture comfort** — how worried SequrAI is about what could be attacked or leaked, independent of deploy hygiene.

**Founder question answered:** *Is my application becoming less secure?*

---

## What should be stored

Same sampling model as [Production Confidence History](./04-production-confidence-history-specification.md):

| Field | Meaning |
|-------|---------|
| `securityConfidence` | 0–100 from verdict |
| `attackSurfaceLevel` | LOW / MED / HIGH at sample |
| `date` | Daily bucket |
| `verdictId` | Link |

Written by:

- `verdict_created`
- `confidence_snapshot`
- `attack_surface_snapshot` (may adjust narrative, not necessarily numeric unless verdict says so)

---

## What should never be stored

- CVE IDs as the **primary** stored identifier (optional internal reference OK; user surfaces use plain language)
- CVSS vectors
- Exploit code or payload samples
- Lists of all vulnerable packages in Memory — use `dependency_snapshot` summary counts only

---

## Triggers that move security confidence (documented for `what_changed`)

| Change | Typical direction |
|--------|-------------------|
| New critical/high finding | ↓ |
| Fix verified on security blocker | ↑ |
| Attack surface level up | ↓ or cap |
| Attack surface level down | ↑ |
| New critical dependency advisory | ↓ |
| Silent day | → |

---

## Founder experience

**Protection Center:** Second line next to production confidence.

```
Security confidence: 98% (→ over 7 days)
```

**Weekly summary bullet:**

> *Security confidence held steady — one new dependency, no critical advisories.*

---

## MCP

| Phrase | Tool |
|--------|------|
| Am I becoming less secure? | `production_history` (security series) + optional `what_changed` |
| What worries you about security? | `can_i_deploy` (worries — not CVE dump) |

**Opinionated line:**

> *I'm less comfortable than last week — mostly because of the new public admin route.*

---

## Daily / weekly / monthly

| Cadence | Behavior |
|---------|----------|
| Daily | Column on `protection_snapshots` |
| Weekly | Delta in weekly summary |
| Monthly | Report section “Security confidence” + attack surface label |

---

## Divergence from production confidence

Store **both** every snapshot. Narrative when they diverge:

> *Production confidence is high, but security confidence lags — I'd fix auth on the new API before marketing launch.*

MCP uses this split in `can_i_deploy` / `production_history` — never merges into one opaque “score.”

---

## Acceptance criteria

- Security sparkline available in UI toggle (doc 09).
- `what_changed` includes security confidence delta when |Δ| ≥ 1.
- No user-facing “CVE count” derived solely from memory without plain-language worry.

# Protection Statistics Specification

**Purpose:** **Quantified proof** of continuous protection — numbers that reinforce trust, not scanner vanity metrics.

---

## Monthly statistics (required)

| Stat | Definition | Memory source |
|------|------------|---------------|
| **Daily protection checks completed** | Successful `continuous_check_completed` | Count in month |
| **Days in period** | Calendar days project eligible | CP ON days |
| **Full protection reviews** | `protection_review_completed` | Count |
| **Important outreach** | User alerts Urgent+Important | `alert_sent` filtered |
| **Unsafe deployments prevented** | `deploy_blocked` | Count |
| **Critical issues addressed** | `fix_verified` severity critical | Count |
| **Production issues prevented** | deploy_blocked + acted-on critical alerts (bible) | Composite rule below |

### Production issues prevented (V1 formula)

```
production_issues_prevented =
  count(deploy_blocked in month)
  + count(material_change_detected where severity critical and recommendation verified in month)
```

Document in implementation; no manual adjustment.

---

## Weekly statistics (subset)

| Stat | Shown |
|------|-------|
| Checks completed | `{n}/7` |
| Full reviews | Optional if &gt; 0 |
| Alerts that mattered | Count or “None” |

Weekly **excludes** month-only counters (unsafe prevented cumulative marketing).

---

## Optional statistics (V1.1 / toggle)

| Stat | Default |
|------|---------|
| Total MCP deploy checks | Off in PDF — in app only |
| Time protected (hours CP ON) | Monthly footnote |
| Dependencies updated | Monthly one-liner |

---

## Display rules

| Rule | Why |
|------|-----|
| Show ratios | `28/30 checks` beats `28` |
| No leaderboard | No “top 10% of users” |
| Zero is OK | `0 unsafe deployments prevented` = good month |
| Internal noise_rate | **Never** in founder report |

---

## Statistics vs four questions

| Question | Stats that help |
|----------|-----------------|
| Am I becoming more protected? | Check ratio + status trend |
| What improved? | Critical issues addressed |
| What worries SequrAI? | Stats don't replace worries — max 1 stat callout |
| What next? | Link stat to action: *“3 deploy blocks → fix {x}”* |

---

## Investor-forward block (optional monthly subsection)

```
CONTINUOUS PROTECTION AT A GLANCE
• {n}/{days} days watched
• {n} critical fixes verified
• {n} times deploy would not have been safe
```

Tone: factual, not fear marketing.

---

## Acceptance criteria

- All counters reproducible from Memory fixture export.  
- Partial month uses eligible days denominator.  
- Weekly stats never contradict monthly rollup (sum of weeks ≈ month, off-by-one documented for timezone).

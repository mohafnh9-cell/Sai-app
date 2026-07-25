# North Star Metrics

---

## North Star Metric (NSM)

### **Number of continuously protected AI-built applications**

**Definition:** A project counts as *continuously protected* when **all** are true:

1. GitHub repository connected and active (not archived).
2. **Continuous Protection = ON** (user has not paused).
3. At least one successful protection review in the last **14 days**.
4. Latest deploy readiness check is **GO** or **CONDITIONAL** (not hard NO-GO)—OR user acknowledged NO-GO and has open remediation plan (CONDITIONAL state).

**Why this metric:** It measures ongoing peace of mind—not vanity scans, not one-time verdicts, not MCP messages for curiosity.

**Anti-patterns (do not optimize):**

- Raw scan count.
- Total CVEs found.
- Dashboard page views without protection outcome.

---

## Primary supporting metrics

| Metric | Definition | Hybrid V1 target |
|--------|------------|------------------|
| **Protected applications** | Same as NSM count | Track weekly growth |
| **Unsafe deployments prevented** | `deploy_blocked` memory events | Increasing with usage |
| **Security confidence (median)** | Across protected apps | ≥ 85 |
| **Production confidence (median)** | Across protected apps | ≥ 85 |
| **Weekly protected projects** | Projects meeting NSM criteria at week end | NSM / total projects ≥ 70% |
| **MCP weekly active users** | Users with ≥ 1 MCP tool success / week | ≥ 50% of MAU |

---

## Activation metrics (first 7 days)

| Metric | Target |
|--------|--------|
| Time to first Production Verdict | &lt; 2 min P95 |
| Time to Ready to Ship (first GO) | &lt; 5 min median (may include fix loop) |
| MCP setup to first tool success | &lt; 60 sec |
| Continuous protection enabled | ≥ 85% of connected projects |
| User understands product (survey) | ≥ 80% agree “SequrAI protects my app” in &lt; 30 sec read of landing |

---

## Retention metrics

| Metric | Target (beta) |
|--------|----------------|
| 30-day project retention (CP still ON) | ≥ 80% |
| 30-day paid retention | ≥ 75% |
| MCP WAU/MAU | ≥ 50% |

---

## Quality metrics (guardrails)

| Metric | Threshold |
|--------|-----------|
| False positive alerts | &lt; 5% of alerts |
| Stuck scan jobs | 0 unrecovered &gt; 15 min |
| Duplicate side effects | 0 |
| Cross-tenant incidents | 0 |

---

## Reporting cadence

| Audience | Cadence | Content |
|----------|---------|---------|
| Team | Weekly | NSM, MCP WAU, prevented deploys, confidence medians |
| Beta users | Monthly | Personal Protection Report (product) |
| Board/advisors | Monthly | NSM chart + cohort conversion |

---

## Instrumentation requirements (when implementing)

Events to track (names illustrative):

- `protection.project.continuous_on`
- `protection.project.continuous_off`
- `mcp.tool.success` (by tool)
- `verdict.deploy_ready` / `verdict.deploy_blocked`
- `memory.event.appended`

NSM computed nightly from Postgres—not from in-process counters.

---

## Decision rule

If a feature increases scans but **does not** increase continuously protected applications, **do not ship it** in Hybrid V1.

---

## Link to beta gates

Each cohort in [11-beta-strategy.md](./11-beta-strategy.md) must show NSM growth week-over-week before expanding invites.

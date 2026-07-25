# Production Memory Layer — Product Documentation

**Sprint scope:** Documentation only — **no implementation, no new MCP tools.**

---

## Mission

Production Memory is the **brain** of SequrAI and one of the **biggest moats** of the company.

SequrAI must remember everything **important** about an application throughout its **entire lifecycle** and become **smarter over time** (richer context, better priorities — rule-based and historical in V1, not ML).

We are **NOT** building a project history page or analytics warehouse.

We **ARE** building **long-term protection memory** for AI-built software.

---

## Product philosophy

The founder should feel:

> *"SequrAI knows my application better than I do."*

> *"My application has been continuously protected for the last 327 days."*

> *"I would feel uncomfortable building or deploying without SequrAI knowing its entire history."*

Production Memory is **NOT** analytics. **NOT** a CVE timeline. **IS** the foundation of Continuous Protection and every downstream surface.

---

## Source of truth for

| Consumer | Memory provides |
|----------|-----------------|
| Continuous Protection | Baseline for diffs, status, recency |
| Daily / weekly / monthly reviews | Aggregates + narrative inputs |
| Monthly Protection Reports | All statistics + evolution |
| Security Alerts | Material change vs last snapshot |
| Protection Status | Latest + transition history |
| Project Health | Composite + component health |
| Auto Remediation | Recommendations lifecycle |
| Future autonomous protection | Approval-gated actions need memory (architecture hooks) |

---

## Documents (14 deliverables)

| # | Deliverable | File |
|---|-------------|------|
| 1 | Project Memory | [01-project-memory-specification.md](./01-project-memory-specification.md) |
| 2 | Protection History | [02-protection-history-specification.md](./02-protection-history-specification.md) |
| 3 | Deployment History | [03-deployment-history-specification.md](./03-deployment-history-specification.md) |
| 4 | Production Confidence History | [04-production-confidence-history-specification.md](./04-production-confidence-history-specification.md) |
| 5 | Security Confidence History | [05-security-confidence-history-specification.md](./05-security-confidence-history-specification.md) |
| 6 | Recommendations History | [06-recommendations-history-specification.md](./06-recommendations-history-specification.md) |
| 7 | Project Health History | [07-project-health-history-specification.md](./07-project-health-history-specification.md) |
| 8 | Protection Timeline | [08-protection-timeline-specification.md](./08-protection-timeline-specification.md) |
| 9 | Memory UX | [09-memory-ux-specification.md](./09-memory-ux-specification.md) |
| 10 | Memory MCP Experience | [10-memory-mcp-experience-specification.md](./10-memory-mcp-experience-specification.md) |
| 11 | Data model | [11-data-model-specification.md](./11-data-model-specification.md) |
| 12 | Update strategy | [12-update-strategy-specification.md](./12-update-strategy-specification.md) |
| 13 | SHIPS NOW vs BACKLOG | [13-ships-now-vs-backlog.md](./13-ships-now-vs-backlog.md) |
| 14 | Future architecture (1k → 50k) | [14-future-architecture-scaling.md](./14-future-architecture-scaling.md) |

(Legacy pointer: [11-future-architecture-and-scope.md](./11-future-architecture-and-scope.md) → 13 + 14.)

**Bible summary:** [07-production-memory-specification.md](../product-bible/07-production-memory-specification.md)  
**Implementation roadmap:** [../roadmap/07-feature-to-sprint-map.md](../roadmap/07-feature-to-sprint-map.md) (S3 primary)

---

## Five MCP tools (frozen)

| Tool | Memory |
|------|--------|
| `production_history` | Story, trends, tenure, milestones |
| `what_changed` | Diffs (day / week / month windows) |
| `can_i_deploy` | Now + worries + protection status |
| `review_now` | **Writes** reviews → memory |
| `safe_fix` | **Writes** recommendations |

---

## Success criteria

- Founder understands full protection story in **&lt;30 seconds** (timeline glance).  
- **100%** completed reviews append memory.  
- MCP answers *"What do you know about my app?"* without raw event dumps.  
- Uncomfortable deploying without SequrAI history — qual at beta N≥10.

**If NO → redesign UX + timeline + MCP narrative, not more tables.**

---

## Governance

**No feature creep:** Memory scope changes require bible doc 03 + [13-ships-now-vs-backlog.md](./13-ships-now-vs-backlog.md) amendment.

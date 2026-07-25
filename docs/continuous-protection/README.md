# Continuous Protection Layer — Product Documentation

**Sprint scope:** Design only — **no implementation.**  
**Mission:** SequrAI continuously protects AI-built software. We sell **trust and peace of mind**, not reviews.

**Relationship to Product Bible:** [06-continuous-protection-specification.md](../product-bible/06-continuous-protection-specification.md) is the bible summary. This pack is the **complete layer design** (workflows, UX, MCP, states, metrics).

**Constraints (this design):**

- No real-time monitoring, WAF, cloud/infra monitoring, Darktrace-class features, or autonomous attack mitigation.
- MCP remains **five tools** — continuous protection is **read from Memory + verdict**, not new tools.
- Behaviour detection V1 is **rule-based only** (no ML).

## Documents

| # | Deliverable | File |
|---|-------------|------|
| 1 | Continuous Protection Specification | [01-continuous-protection-specification.md](./01-continuous-protection-specification.md) |
| 2 | Daily Protection Review Specification | [02-daily-protection-review-specification.md](./02-daily-protection-review-specification.md) |
| 3 | Weekly Protection Review Specification | [03-weekly-protection-review-specification.md](./03-weekly-protection-review-specification.md) |
| 4 | Protection Status Specification | [04-protection-status-specification.md](./04-protection-status-specification.md) |
| 5 | Production Health Specification | [05-production-health-specification.md](./05-production-health-specification.md) |
| 6 | Dependency Monitoring Specification | [06-dependency-monitoring-specification.md](./06-dependency-monitoring-specification.md) |
| 7 | Behaviour Detection V1 Specification | [07-behaviour-detection-v1-specification.md](./07-behaviour-detection-v1-specification.md) |
| 8 | Protection Center Specification | [08-protection-center-specification.md](./08-protection-center-specification.md) |
| 9 | MCP Continuous Protection Experience | [09-mcp-continuous-protection-experience.md](./09-mcp-continuous-protection-experience.md) |
| 10 | Future Architecture Specification | [10-future-architecture-specification.md](./10-future-architecture-specification.md) |

## Layer questions (north star)

Every surface (daily job, weekly summary, Protection Center, MCP) must help answer:

1. Is my application protected?
2. Is it becoming less secure?
3. Has anything changed since yesterday?
4. Should I worry about something?
5. Is production confidence increasing or decreasing?
6. What should I fix next?

## Related docs

- Product layers: [../product-bible/04-product-layers.md](../product-bible/04-product-layers.md)
- Production Memory: [../production-memory/README.md](../production-memory/README.md) (bible summary: [../product-bible/07-production-memory-specification.md](../product-bible/07-production-memory-specification.md))
- MCP voice & intents: [../mcp-product/README.md](../mcp-product/README.md)
- Hybrid V1 scope: [../product-bible/03-hybrid-v1-scope.md](../product-bible/03-hybrid-v1-scope.md)

## Success criterion

> A founder should say: *"I don't even think about cybersecurity anymore because SequrAI is continuously protecting my application."*

If the design does not earn that sentence, iterate on **status clarity**, **silent success**, and **one recommended action** — not on more dashboards or CVE tables.

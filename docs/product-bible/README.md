# SequrAI Product Bible

**Status:** Single source of truth for Hybrid V1 (6 months).  
**Effective:** 2026-07-24  
**Rule:** No feature ships unless it appears in this bible. No product vision changes for 6 months.

## Documents

| # | Document | File |
|---|----------|------|
| 1 | Product Vision ADR | [01-product-vision-adr.md](./01-product-vision-adr.md) |
| 2 | Product Philosophy | [02-product-philosophy.md](./02-product-philosophy.md) |
| 3 | Hybrid V1 Scope | [03-hybrid-v1-scope.md](./03-hybrid-v1-scope.md) |
| 4 | Product Layers | [04-product-layers.md](./04-product-layers.md) |
| 5 | MCP Product Specification | [05-mcp-product-specification.md](./05-mcp-product-specification.md) |
| 6 | Continuous Protection | [06-continuous-protection-specification.md](./06-continuous-protection-specification.md) |
| 7 | Production Memory | [07-production-memory-specification.md](./07-production-memory-specification.md) |
| 8 | Auto Remediation | [08-auto-remediation-specification.md](./08-auto-remediation-specification.md) |
| 9 | Technical Architecture | [09-technical-architecture.md](./09-technical-architecture.md) |
| 10 | Pricing | [10-pricing.md](./10-pricing.md) |
| 11 | Beta Strategy | [11-beta-strategy.md](./11-beta-strategy.md) |
| 12 | North Star Metrics | [12-north-star-metrics.md](./12-north-star-metrics.md) |

## Governance

- **SHIPS NOW** → must appear in doc 03 with acceptance criteria.
- **ARCHITECTURE ONLY** → designed in docs 04–09; no user-facing ship until promoted in doc 03.
- **BACKLOG** → explicitly deferred; not built in Hybrid V1.

## UX sprint (onboarding & first 5 minutes)

Implementation-free spec for the current UX sprint: [../ux-sprint/README.md](../ux-sprint/README.md). No new product features—copy, flow, and hierarchy only.

## MCP product (MCP is the product)

Documentation-only MCP sprint — five tools frozen, no new backend: [../mcp-product/README.md](../mcp-product/README.md).

## Continuous Protection layer (complete design)

Documentation-only — daily/weekly/status, Protection Center, deps, behaviour rules, MCP voice, ship vs backlog: [../continuous-protection/README.md](../continuous-protection/README.md).

## Production Memory layer (complete design)

Documentation-only — project memory, histories, timeline, UX, MCP read/write contracts, ship vs backlog: [../production-memory/README.md](../production-memory/README.md).

## Security Alerts layer (complete design)

Documentation-only — material-only alerts, severity, UX, daily/weekly/monthly, MCP parity, &lt;5% noise: [../security-alerts/README.md](../security-alerts/README.md).

## Protection Reports (weekly + monthly)

Documentation-only — proof artifacts, summaries, stats, evolution, founder + MCP experience: [../protection-reports/README.md](../protection-reports/README.md).

## Auto Remediation layer (Detect → Protect)

Documentation-only — Safe Fix, diff/PR with mandatory approval, verify, rollback, MCP: [../auto-remediation/README.md](../auto-remediation/README.md).

## Hybrid V1 technical architecture (complete)

Documentation-only — MCP, CP, memory, events, alerts, reports, remediation, DB, scaling 1k→50k: [../hybrid-v1-architecture/README.md](../hybrid-v1-architecture/README.md).

## 6-month implementation roadmap (final)

**No feature outside this roadmap:** [../roadmap/README.md](../roadmap/README.md) — sprints S1–S12, beta **25 → 100 → 300 → 500 → 1,000** (Private Beta USA).

## Final question

See [01-product-vision-adr.md](./01-product-vision-adr.md#final-recommendation-test) and [03-hybrid-v1-scope.md](./03-hybrid-v1-scope.md#final-recommendation-test).

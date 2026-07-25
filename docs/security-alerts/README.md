# Security Alerts Layer — Product Documentation

**Sprint scope:** Design only — **no implementation, no new MCP tools, no real-time attack detection.**

**Mission:** SequrAI alerts founders **only when something important happens** — so they feel watched, not spammed.

**Target:** **&lt; 5% alert noise** (user alerts ÷ daily protection checks).

**Related:**

- Material change rules: [../continuous-protection/01-continuous-protection-specification.md](../continuous-protection/01-continuous-protection-specification.md)
- Behaviour rules: [../continuous-protection/07-behaviour-detection-v1-specification.md](../continuous-protection/07-behaviour-detection-v1-specification.md)
- Memory: `alert_sent` in [../production-memory/01-project-memory-specification.md](../production-memory/01-project-memory-specification.md)
- **Ops alerts** (internal SRE): [../operations/alert-routing.md](../operations/alert-routing.md) — **not** this layer

## Documents

| # | Deliverable | File |
|---|-------------|------|
| 1 | Alert philosophy | [01-alert-philosophy-specification.md](./01-alert-philosophy-specification.md) |
| 2 | Alert types | [02-alert-types-specification.md](./02-alert-types-specification.md) |
| 3 | Alert severity levels | [03-alert-severity-levels-specification.md](./03-alert-severity-levels-specification.md) |
| 4 | Alert UX | [04-alert-ux-specification.md](./04-alert-ux-specification.md) |
| 5 | Alert workflows | [05-alert-workflows-specification.md](./05-alert-workflows-specification.md) |
| 6 | Founder experience | [06-founder-experience-specification.md](./06-founder-experience-specification.md) |
| 7 | Daily alerts | [07-daily-alerts-specification.md](./07-daily-alerts-specification.md) |
| 8 | Weekly alerts | [08-weekly-alerts-specification.md](./08-weekly-alerts-specification.md) |
| 9 | Monthly alerts | [09-monthly-alerts-specification.md](./09-monthly-alerts-specification.md) |
| 10 | MCP experience | [10-mcp-alerts-experience-specification.md](./10-mcp-alerts-experience-specification.md) |
| — | Scope (SHIPS NOW vs backlog) | [11-future-architecture-and-scope.md](./11-future-architecture-and-scope.md) |

## Every alert must answer

1. **Should I worry?** — clear yes/no/caution in the first line  
2. **What changed?** — one plain-language diff, not a CVE list  
3. **What should I do next?** — single primary action (usually Safe Fix or Review again)

## Success criterion

Founders trust alerts enough to **leave email ON** — because silence means *“you're protected”* and pings mean *“SequrAI caught something.”*

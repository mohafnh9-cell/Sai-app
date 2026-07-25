# SequrAI MCP Product Documentation

**Sprint scope:** MCP experience only — **documentation, no implementation.**  
**Constraint:** Exactly **five tools** — no new tools, no new backend features.  
**Out of scope:** Continuous Protection, Production Memory, alerts, reports, auto remediation, behaviour detection.

**The MCP is the product.** The web app supports onboarding and configuration.

## Documents

| # | Deliverable | File |
|---|-------------|------|
| 1 | MCP Product Specification | [01-mcp-product-specification.md](./01-mcp-product-specification.md) |
| 2 | MCP User Experience | [02-mcp-user-experience.md](./02-mcp-user-experience.md) |
| 3 | MCP Personality Specification | [03-mcp-personality-specification.md](./03-mcp-personality-specification.md) |
| 4 | Natural Language Intent Specification | [04-natural-language-intent-specification.md](./04-natural-language-intent-specification.md) |
| 5 | MCP Onboarding Experience | [05-mcp-onboarding-experience.md](./05-mcp-onboarding-experience.md) |
| 6 | MCP Response Design System | [06-mcp-response-design-system.md](./06-mcp-response-design-system.md) |
| 7 | MCP Conversation Examples | [07-mcp-conversation-examples.md](./07-mcp-conversation-examples.md) |
| 8 | Intent → Tool Mapping | [08-intent-to-tool-mapping.md](./08-intent-to-tool-mapping.md) |
| 9 | MCP Success Metrics | [09-mcp-success-metrics.md](./09-mcp-success-metrics.md) |
| 10 | Simplify & Remove | [10-simplify-and-remove.md](./10-simplify-and-remove.md) |

## The five tools (frozen)

| Tool | Role |
|------|------|
| `review_now` | Protect / review / investigate (fresh analysis) |
| `can_i_deploy` | Deploy gate + **Am I protected?** (read verdict) |
| `safe_fix` | Fix this problem |
| `what_changed` | What changed? |
| `production_history` | Health / history / trends |

## Implementation gate

When engineering begins, changes are limited to: **copy, response formatting, client instructions, tool descriptions, i18n (`messages/*/mcp.json`)** — not new tools or backends.

Related UX sprint (Cursor setup in app): [../ux-sprint/04-mcp-onboarding-redesign.md](../ux-sprint/04-mcp-onboarding-redesign.md)

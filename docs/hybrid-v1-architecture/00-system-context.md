# System Context (Hybrid V1)

Single-page C4 **context** view — detail in numbered docs.

```mermaid
flowchart TB
  subgraph users [Users]
    F[Founders]
    MCPClient[Cursor / MCP clients]
  end

  subgraph vercel [Vercel]
    APP[Next.js App + API]
    MCPRoute[MCP routes]
  end

  subgraph data [Data]
    PG[(Supabase Postgres)]
  end

  subgraph orch [Orchestration]
    INNG[Inngest]
  end

  subgraph ext [External]
    GH[GitHub]
    ST[Stripe]
    EM[Email]
  end

  F --> APP
  MCPClient --> MCPRoute
  APP --> PG
  MCPRoute --> PG
  APP --> INNG
  MCPRoute --> INNG
  INNG --> APP
  INNG --> GH
  APP --> GH
  APP --> ST
  INNG --> EM
  INNG --> PG
```

**Data flow summary:**

| Path | Flow |
|------|------|
| Protect now | MCP → job → verdict → memory |
| Protect always | Inngest → daily → memory → alerts |
| Proof | Inngest → monthly aggregator → email |
| Fix | MCP/API → recommendation → optional GitHub PR |
| Operate | Health → ops-alerts logs |

See [10-scaling-strategy.md](./10-scaling-strategy.md) for tier checklist.

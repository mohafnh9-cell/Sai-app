# SequrAI — Production & Security OS for AI-built Apps

> **Never deploy an AI-built application without SequrAI.**

SequrAI answers the question every AI builder asks: **Is my app ready for production?** It analyzes security, authentication, database design, best practices, and deployment readiness — then gives you AI-powered fixes for every blocker.

Built for apps created with Cursor, Claude Code, Lovable, Bolt, Vercel, Supabase, and Firebase.

## Stack

- **Framework**: Next.js 16 App Router (TypeScript)
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **Database**: PostgreSQL via Supabase
- **Auth**: Supabase Auth (email/password + GitHub OAuth)
- **Payments**: Stripe (subscriptions + webhooks)
- **AI**: Anthropic Claude for production analysis and fix generation
- **Email**: Resend for notifications
- **Deploy**: Vercel

## Core Concepts

### Production Ready Score (PRS)

The primary metric across the dashboard and project views. Weighted across seven dimensions:

- Security
- Authentication
- Database Design
- Best Practices
- Architecture
- Performance
- Deployment Readiness

### Security Brain v0

Central read-only aggregator that merges scan results, AI priorities, activity feeds, and health state. Engines write data; the Brain reads and exposes unified snapshots via API.

### GitHub Automation

Every push and PR triggers an incremental production check. Results flow into the Brain, update commit status, and notify your team.

## Project Structure

```
sequrai-app/
├── app/
│   ├── (auth)/              # Public auth pages
│   ├── (dashboard)/         # Protected dashboard routes
│   └── api/
│       ├── brain/           # Brain snapshot APIs
│       ├── repositories/    # Scan triggering
│       └── scans/           # Scan detail + AI analysis
├── brain/                   # Production readiness calculator + types
├── features/
│   ├── security-scanner/    # Scan engine (rules, scoring)
│   ├── ai-security-engine/  # Claude-powered analysis
│   └── github-automation/   # Webhooks, orchestrator, activity
├── server/
│   ├── brain/               # Brain builders + persistence
│   ├── security-scanner/    # Scan job runner
│   └── github-automation/   # Post-scan pipeline
└── database/migrations/     # Supabase SQL migrations
```

## Getting Started

### 1. Environment variables

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `GITHUB_WEBHOOK_SECRET`
- `NEXT_PUBLIC_APP_URL`

### 2. Run migrations

Apply SQL migrations in `database/migrations/` to your Supabase project (001 through 009).

### 3. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/brain/organization` | Org-level production readiness snapshot |
| `GET /api/brain/project/{projectId}` | Project-level Brain snapshot |
| `POST /api/repositories/{id}/scans` | Trigger a production readiness check |
| `GET /api/scans/{scanId}/ai-analysis` | AI analysis for a completed scan |

| `POST /api/mcp` | MCP JSON-RPC endpoint (Production Copilot tools) |
| `GET/POST/DELETE /api/mcp/keys` | Manage MCP API keys |

## MCP Integration (Block 7)

Connect Cursor or Claude Code to your Production Copilot:

1. Run migration **009** in Supabase (`mcp_api_keys` table).
2. Open **Settings → MCP Integration** and generate an API key.
3. Add to `.cursor/mcp.json` in **your project root** (any repo — no SequrAI clone):

```json
{
  "mcpServers": {
    "sequrai": {
      "url": "https://sequrai-app.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer your-mcp-api-key-from-settings"
      }
    }
  }
}
```

For Claude Code, add `"type": "http"` under the `sequrai` server entry. See `docs/MCP_CURSOR_SETUP.md` for details.

### Available MCP tools

Exactly five public tools are registered (enforced by
`server/mcp/__tests__/tool-surface.test.ts`), plus `list_projects` as
project-selection infrastructure. See `docs/MCP_V1_PRODUCTION_ENGINE.md` for
the product design behind this constraint and
`docs/ADR_001_ARCHITECTURE_CLEANUP_REPORT.md` for the naming history.

| Tool | Description |
|------|-------------|
| `list_projects` | List org projects with Production Ready Score (infrastructure, not a product question) |
| `get_production_readiness` | Production Verdict, score, priorities, and recommended action for a project |
| `review_current_changes` | Run a production check on the latest code and return the updated verdict |
| `explain_production_blocker` | Explain why a blocker prevents shipping and return a Cursor-ready fix prompt |
| `get_production_blockers` | List production blockers from the latest completed scan |

## Scripts

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run typecheck    # TypeScript check
npm run test         # Run all tests
npm run lint         # ESLint
```

## Roadmap

- **Block 5.5** ✅ Production Ready Score, Security Brain v0, UX alignment
- **Block 7** ✅ MCP integration + Production Copilot
- **Block 8** — Vercel/Supabase deep integrations

## License

Proprietary — SequrAI © 2026

# Private Beta Environment Checklist

> For **market launch** (Builder Edition €5/month, paid-only), use [MARKET_LAUNCH_CHECKLIST.md](./MARKET_LAUNCH_CHECKLIST.md).

Use this before inviting the first 25 builders.

## 1. Supabase migrations

Run in order in the Supabase SQL Editor (or via CI):

1. `001_initial_schema.sql`
2. `002_scan_engine_v1.sql`
3. `003_user_github_tokens.sql`
4. `004_reset_scan_schema.sql` — **ONE-TIME ONLY on empty/legacy scan tables**
5. `005_ai_security_engine.sql`
6. `006_github_automation.sql`
7. `007_fix_repository_scan_state_rls.sql`
8. `008_production_readiness.sql`
9. `009_mcp_api_keys.sql`
10. `010_production_verdicts.sql`
11. `011_profiles_locale.sql`
12. `012_repository_sync_status.sql`
13. `013_automatic_production_reviews.sql`
14. `014_verdict_autopilot.sql`
15. `015_organization_security_hardening.sql`

Verify:

```bash
node scripts/schema-health-check.mjs
```

## 2. Vercel / production environment

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_APP_URL` | Yes | Must match deployed domain |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server only — never expose to client |
| `GITHUB_WEBHOOK_SECRET` | Yes | Same value registered on GitHub webhooks |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Recommended | 32-byte base64 AES key |
| `ANTHROPIC_API_KEY` | Optional | AI summaries |
| `SEQURAI_BYPASS_AUTH` | **Must be unset** | Build fails if set in production |

Validate:

```bash
node scripts/validate-env.mjs --production
```

## 3. GitHub OAuth (Supabase)

- Enable GitHub provider in Supabase Auth
- Scopes: `repo`, `admin:repo_hook`, `read:user`, `user:email`
- Callback URL: `{APP_URL}/auth/callback`

## 4. GitHub webhooks

- Webhook URL: `{NEXT_PUBLIC_APP_URL}/api/webhooks/github`
- Secret: must match `GITHUB_WEBHOOK_SECRET`
- Events: `push` (minimum for Continuous Reviews)

## 5. Pre-launch smoke test

1. Sign up / sign in
2. Create organization (via onboarding)
3. Connect GitHub repository via Integrations
4. Confirm webhook registered
5. Run or wait for first Production Review
6. Confirm Production Verdict on project page
7. Push a commit to the connected repo
8. Confirm webhook delivery in GitHub
9. Confirm Continuous Reviews state updates
10. Confirm Production Verdict updates

## 6. Security confirmations

- [ ] Migration 015 applied (org membership RLS + RPC)
- [ ] `SEQURAI_BYPASS_AUTH` not set in Vercel production
- [ ] Service role key not in client bundle
- [ ] `GITHUB_TOKEN_ENCRYPTION_KEY` set (recommended)

## 7. Known beta limitations

- GitHub tokens encrypted at rest only when `GITHUB_TOKEN_ENCRYPTION_KEY` is configured
- Large repositories may hit serverless timeout (60s) on inline scans
- Stripe billing not required for Builder Edition beta
- Manual E2E must be run on your production deployment — unit tests alone are insufficient

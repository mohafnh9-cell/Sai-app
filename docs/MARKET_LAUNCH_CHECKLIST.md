# Market Launch Checklist

Use this before opening public paid access (Builder Edition €5/month).

## 1. Supabase migrations

Run in order in the Supabase SQL Editor (or via CI):

`001_initial_schema.sql` through `048_automatic_target_verification.sql` (48 migrations).

Verify:

```bash
node scripts/schema-health-check.mjs
node scripts/migration-preflight.mjs
```

## 2. Vercel / production environment

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_APP_URL` | Yes | Must match deployed domain |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server only — never expose to client |
| `GITHUB_WEBHOOK_SECRET` | Yes | Same value registered on GitHub webhooks |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | **Yes** | 32-byte base64 AES key — required for production |
| `STRIPE_SECRET_KEY` | **Yes** | Live or test depending on launch phase |
| `STRIPE_WEBHOOK_SECRET` | **Yes** | From Stripe webhook endpoint |
| `STRIPE_BUILDER_PRICE_ID` | **Yes** | Builder Edition €5/month price |
| `SCAN_RATE_LIMIT_ENABLED` | Optional | Production enables limits by default; set `SCAN_RATE_LIMIT_DISABLED=1` to opt out |
| `SENTRY_DSN` | Recommended | Production error monitoring |
| `SEQURAI_ADMIN_EMAILS` | Recommended | Internal team emails — admin bypass without subscription |
| `ANTHROPIC_API_KEY` | Optional | AI summaries |
| `SEQURAI_BYPASS_AUTH` | **Must be unset** | Build fails if set in production |
| `SEQURAI_SKIP_TARGET_VERIFICATION` | **Must be unset** | Build fails if set in Vercel production |

Optional grace period for existing beta orgs:

| Variable | Notes |
|----------|-------|
| `SUBSCRIPTION_GRACE_UNTIL` | ISO date — FREE orgs keep access until this timestamp |

Validate:

```bash
node scripts/validate-env.mjs --production
```

## 3. Stripe

1. Create **Builder Edition** product at €5/month in Stripe Dashboard.
2. Configure webhook: `POST https://<your-domain>/api/stripe/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Enable Stripe Customer Portal (cancel / update card).
5. Run 2–3 test checkouts in test mode before switching live keys.

## 4. Supabase Auth redirect URLs

Add to Supabase Auth → URL configuration:

- `https://<your-domain>/auth/callback`
- `https://<your-domain>/reset-password`

## 5. GitHub OAuth (Supabase)

- GitHub provider enabled with repo + webhook scopes.
- Production callback URL matches Supabase project settings.

## 6. Smoke verification

```bash
node scripts/production-e2e-verify.mjs
```

Expected:

- Billing page loads for authenticated users
- Checkout API returns 401 without session
- Core scan / mission-control flows pass for paid org fixture

## 7. Legal & product copy

- Landing, `/billing`, and Terms all say **Builder Edition €5/month**
- Privacy policy mentions Stripe billing and account deletion in Settings
- Reset password flow tested end-to-end

## 8. Launch day

- [ ] Stripe live keys in Vercel production
- [ ] Sentry receiving events
- [ ] `SEQURAI_ADMIN_EMAILS` set for internal team
- [ ] `npm run test:release` green on `main`
- [ ] Remove or expire `SUBSCRIPTION_GRACE_UNTIL` when beta grace ends

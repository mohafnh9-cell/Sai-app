# Staging platform convergence fixture

Safe, non-production hybrid repository used for **Platform Convergence Staging Certification** (Scenarios A–D).

## Intended signals

| Category | Signals |
|----------|---------|
| Business logic | Checkout/billing module, webhook handler, tenant/org model, authenticated admin route |
| AI | One supported LLM provider config, system prompt, tool/function calling stub, optional RAG/MCP stub |

## Version pin

- **Repository:** `sequrai/staging-platform-convergence-fixture` (create or mirror in your staging GitHub org)
- **Commit:** Pin in `docs/stabilization/platform-convergence-staging-certification.md` after each certification run

## Local substitute

For deterministic unit/E2E coverage without staging, use:

- `server/ai-red-team/e2e-validation/fixtures/` (hybrid discovery inputs)
- `npm run validate:platform-convergence`
- `npm run validate:platform-e2e`

## Secrets

No real API keys, production webhooks, or customer data. Use placeholder env vars only.

# Technical debt register (post-Sprint 8)

| ID | Area | Description | Severity | Suggested sprint |
|----|------|-------------|----------|------------------|
| TD-01 | Metrics | In-process counters reset on cold start | Medium | Export to Prometheus/Datadog |
| TD-02 | Cache | Per-instance memory cache (not shared on serverless) | Medium | Redis / Vercel KV with same TTL keys |
| TD-03 | Cost | No per-request token logging | Medium | Scan finalize metadata |
| TD-04 | Cron | Eligible project lists hard cap 500 | High at 10k repos | Cursor pagination by org |
| TD-05 | Typecheck | Legacy `onboarding-flow` / Inngest handler types | Low | Engineering cleanup |
| TD-06 | LLM health | Readiness check does not ping Anthropic | Low | Optional HEAD/rate-limit probe |
| TD-07 | Events retention | `scan_job_events` unbounded growth | Medium | TTL archive job |
| TD-08 | Load tests | Documented scenarios; automated stress in CI partial | Medium | Dedicated perf workflow |
| TD-09 | Feature flags | Env JSON only (no remote config) | Low | Edge Config integration |
| TD-10 | MCP timing | Aggregated under `mcp.tool` | Low | Per-tool dashboards via meta.tool |

Items do **not** block private beta if migration 027 is applied and ops monitoring is active.

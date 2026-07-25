# Alerts Architecture (Hybrid V1)

**Product spec:** [../security-alerts/README.md](../security-alerts/README.md)

**Split:** **User alerts** (founders) vs **ops alerts** (team) — never shared pipeline.

---

## User alerts topology

```
Material change / behaviour rule / integration loss
        ▼
Alert evaluator (sync in CP job or post-verdict hook)
        ▼
Dedupe store (Postgres unique on dedupeKey)
        ▼
security_notifications + optional email queue
        ▼
Memory: alert_sent
```

---

## Components

| Component | Responsibility |
|-----------|----------------|
| **Evaluator** | Map finding/snapshot delta → alertKind (AT-xx) |
| **Dedupe** | `UNIQUE(project_id, dedupe_key)` or idempotency table |
| **In-app store** | `security_notifications` rows + read state |
| **Email sender** | Inngest step or outbox worker; Resend API |
| **Formatter** | Three-block body (worry / changed / next) |

---

## Ops alerts (separate)

```
GET /api/internal/jobs/health + recovery cron
        ▼
evaluateOperationalAlerts()
        ▼
stdout component=ops-alerts
        ▼
Log drain → PagerDuty / Slack
```

No write to `security_notifications`.

---

## Scale

| Tier | Approach |
|------|----------|
| 1k | Inline email after alert row insert |
| 10k | Batch digest email worker; daily cap per project |
| 50k | Outbox + rate limit email provider; in-app always written |

**Noise target:** &lt;5% alerts / daily checks — product metric, not infra.

---

## Idempotency keys

Stored on notification row + Memory event.  
See [../security-alerts/02-alert-types-specification.md](../security-alerts/02-alert-types-specification.md).

---

## MCP

No alert API surface — reads via verdict + Memory.  
Optional: unread count in `can_i_deploy` formatter query (indexed `read_at IS NULL`).

---

## Related

- [04-event-architecture.md](./04-event-architecture.md)  
- [06-monthly-reports-architecture.md](./06-monthly-reports-architecture.md) — alert rollup only

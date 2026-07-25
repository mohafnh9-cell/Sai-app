# Alert Types Specification

**Purpose:** Canonical catalog of **founder-facing** alert types — each mapped to trigger, severity, channel, dedupe key, and Memory event.

**Prefix:** User alerts use `alertKind` values below. Ops alerts (`stuck_jobs`, etc.) are **excluded**.

---

## Type catalog (Hybrid V1)

| ID | alertKind | Trigger | Default severity | Immediate? | Email default |
|----|-----------|---------|----------------|------------|---------------|
| **AT-01** | `material_finding_critical` | New **critical** finding vs last snapshot | Urgent | Yes | If email ON |
| **AT-02** | `material_finding_high` | New **high** finding + confidence drop ≥ 5 OR status → REQUIRES ATTENTION | Important | Yes | If email ON |
| **AT-03** | `confidence_cliff` | BD-01: confidence drop ≥ 10 in 24h | Urgent | Yes | If email ON |
| **AT-04** | `attack_surface_increased` | Attack surface level up (e.g. LOW→MED) | Important | Yes | If email ON |
| **AT-05** | `dependency_critical_new` | New critical advisory on tracked dep | Important | Yes | If email ON |
| **AT-06** | `unsafe_config_change` | BD-06: auth removed, wildcard CORS, exposed admin | Urgent | Yes | If email ON |
| **AT-07** | `protection_status_regression` | Status worsens (e.g. PROTECTED → REQUIRES ATTENTION) | Important | Yes | If email ON |
| **AT-08** | `watch_stale` | BD-03: no check 14d, CP ON | Important | Yes | If email ON |
| **AT-09** | `protection_paused` | User paused CP (BD-07) | Important | Once | If email ON |
| **AT-10** | `github_disconnected` | GitHub integration lost | Important | Once | If email ON |
| **AT-11** | `deploy_blocked` | `can_i_deploy` NO-GO | Digest | In-app only | **No** |
| **AT-12** | `check_delayed` | 3 failed daily jobs | Important | Yes | If email ON |
| **AT-13** | `finding_accumulation` | BD-02: 3+ new medium in 7d | Digest | Weekly only | No |
| **AT-14** | `deploy_anxiety` | BD-04: 3+ NO-GO in 7d | Digest | Weekly only | No |
| **AT-15** | `heavy_churn` | BD-05: 5+ pushes/24h + findings up | Digest | Weekly only | No |

---

## Non-alert outcomes (Memory only)

| Event | Why not alert |
|-------|---------------|
| `continuous_check_completed` silent | Peace of mind |
| Medium/low finding with stable confidence | Weekly rollup |
| User-initiated `review_now` with no material delta | Expected workflow |
| GO deploy check | Positive — optional timeline only |
| Fix verified | Positive — timeline, not alert |

---

## Payload schema (user alert record)

| Field | Purpose |
|-------|---------|
| `alertId` | UUID |
| `projectId`, `organizationId` | Scope |
| `alertKind` | From table above |
| `severity` | urgent \| important \| digest |
| `dedupeKey` | Idempotency |
| `titlePlain` | Push/in-app title |
| `bodyPlain` | Structured: worry / changed / next |
| `ctaType` | safe_fix \| review_again \| open_protection \| reconnect_github \| resume_cp |
| `ctaTargetId` | recommendationId, etc. |
| `createdAt` | Timestamp |
| `readAt` | Nullable |
| `dismissedAt` | Nullable |

Memory: append `alert_sent` with `{ channel, alertKind, dedupeKey, alertId }`.

---

## Dedupe keys (examples)

| Type | dedupeKey pattern |
|------|-------------------|
| AT-01 | `{projectId}:critical:{findingStableId}:{day}` |
| AT-03 | `{projectId}:conf_cliff:{day}` |
| AT-05 | `{projectId}:dep:{advisoryId}` |
| AT-07 | `{projectId}:status:{from}:{to}:{day}` |
| AT-09 | `{projectId}:paused:{pausedEventId}` |
| AT-11 | `{projectId}:deploy_blocked:{day}` — max 1 in-app per day |

---

## Monthly vs alert types

**Monthly Protection Report** is **not** an alert type — it is scheduled **proof** (doc 09). It may **summarize** alerts received in the period without re-firing them.

---

## Acceptance criteria

- Every `alertKind` has owner doc section in daily (07) or weekly (08).  
- No alert type references CVE count in `titlePlain`.  
- Catalogue frozen for Hybrid V1 unless bible amendment.

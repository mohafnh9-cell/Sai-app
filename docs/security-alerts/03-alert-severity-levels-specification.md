# Alert Severity Levels Specification

**Purpose:** Founder-facing urgency — **not** CVSS, not scanner severity export 1:1.

Three levels only in V1:

| Level | Internal enum | Founder label |
|-------|---------------|---------------|
| **Urgent** | `urgent` | *Needs attention now* |
| **Important** | `important` | *Before your next deploy* |
| **Digest** | `digest` | *Worth knowing this week* |

---

## Mapping rules

### Urgent

Assign when **any**:

- New **critical** finding (AT-01)
- Confidence cliff ≥ 10 / 24h (AT-03)
- Unsafe config change (AT-06)
- Protection status → REQUIRES ATTENTION **and** primary cause is critical/high blocker

**UX:** Red-accent badge, top of inbox, optional email immediately.

**Founder worry line:**

> *Yes — I'd stop and fix this before shipping.*

### Important

Assign when **any**:

- New high finding with material impact (AT-02)
- Attack surface increased (AT-04)
- New critical dependency advisory (AT-05)
- Status regression not covered by Urgent (AT-07)
- Watch stale, check delayed, GitHub disconnected, CP paused (AT-08–10, AT-12)

**UX:** Amber badge, in-app; email if enabled.

**Founder worry line:**

> *You should address this soon — I'm not fully comfortable yet.*

### Digest

Assign when **any**:

- Finding accumulation medium (AT-13)
- Repeated NO-GO pattern (AT-14)
- Heavy churn highlight (AT-15)
- Deploy blocked (AT-11) — **in-app digest slot**, not email

**UX:** Rolled into **weekly** card/email section “This week I noticed…” — no push-style interrupt.

**Founder worry line:**

> *Not an emergency — but let's not ignore the pattern.*

---

## Severity vs finding severity

| Scanner finding severity | Alert severity when new |
|--------------------------|-------------------------|
| critical | Urgent (AT-01) |
| high | Important if material (AT-02); else digest via BD-02 |
| medium | Digest only via BD-02 |
| low | **No alert** — Memory only |

**Material gate:** High finding alone does **not** alert if confidence unchanged and status stays PROTECTED — unless it enters top-3 worries newly.

---

## Severity vs protection status

| protectionStatus | Max alert severity without new material event |
|------------------|-----------------------------------------------|
| PROTECTED | Digest only |
| SAFE WITH CAUTION | Important |
| REQUIRES ATTENTION | Urgent allowed on **new** material trigger |
| NOT PROTECTED | Important (onboarding/recovery), not daily Urgent spam |

---

## Escalation (within V1, no new jobs)

**No auto-escalation email on day 2** for same dedupeKey.

Optional **single** reminder:

- Urgent unread **7 days** → one Important in-app “Still open: {title}” with **new** dedupeKey `{alertId}:reminder`

Backlog: configurable reminder policy.

---

## De-escalation

When user **verifies fix** (`fix_verified`) or status improves:

- Auto-resolve open alerts tied to `findingStableId` or `recommendationId`
- No “all clear” email unless user opts into **positive** weekly summary (default: in weekly prose only)

---

## Copy templates by severity

### Urgent (push/in-app title)

```
Something important changed in {Project}
```

### Important

```
SequrAI is watching — {Project} needs a look
```

### Digest (weekly section header)

```
Patterns I noticed this week
```

**Never:** `CRITICAL ALERT: 3 vulnerabilities`

---

## Metrics

| Metric | Target |
|--------|--------|
| Urgent share of all alerts | &lt; 25% |
| Digest share | 40–60% (absorbs noise) |
| Reminder rate | &lt; 5% of Urgent |

---

## Acceptance criteria

- Every alertKind in doc 02 has exactly one default severity.  
- UI shows founder label, not enum string.  
- Severity drives sort order: Urgent → Important → Digest → read.

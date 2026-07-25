# Natural Language Intent Specification

**Rule:** Every user intent maps to **one or more of five tools** — never to a sixth capability.  
**Routing:** MCP **client** selects tools using descriptions + server instructions; this doc is the **canonical intent catalog** for copy, eval, and instructions updates.

---

## Canonical questions (product)

| # | User intent | Primary tool | Secondary tools |
|---|-------------|--------------|-----------------|
| 1 | Can I deploy? | `can_i_deploy` | — |
| 2 | Am I protected? | `can_i_deploy` | (framing only) |
| 3 | What worries you about my application? | `can_i_deploy` | — |
| 4 | What changed? | `what_changed` | — |
| 5 | What should I fix first? | `can_i_deploy` → `safe_fix` | or `safe_fix` if blocker named |
| 6 | How healthy is my application? | `production_history` | `can_i_deploy` for current |
| 7 | Would you deploy if it was your company? | `can_i_deploy` | — |
| 8 | Protect my application | `review_now` | `can_i_deploy` after |
| 9 | Review my project / SaaS | `review_now` | — |
| 10 | Review again | `review_now` | `reason: after_fix` when applicable |

---

## Intent catalog (phrases → tools)

### `CAN_I_DEPLOY` → `can_i_deploy`

**Signals:** deploy, ship, launch, publish, release, production, go live, ready, real users, would you release, desplegar, lanzar, producción.

**Example phrases:**

- Can I deploy?
- Is this ready to ship?
- Should I push to production?
- Would you launch this?
- Am I good to go live?
- ¿Puedo desplegar?

**Anti-routing:** If user says “scan before deploy” → `REVIEW_NOW` first.

**Response lead:** YES / NO / NOT YET + worries + action.

---

### `AM_I_PROTECTED` → `can_i_deploy` (composite framing)

**Signals:** protected, protection status, peace of mind, safe in production, am I safe, estoy protegido.

**Example phrases:**

- Am I protected?
- Is my application protected?
- Show my protection status.
- Can I trust this in production?

**Not a separate tool.** Same data as deploy gate; opening sentence uses **comfort/protection** language (doc 03).

---

### `WHAT_WORRIES_YOU` → `can_i_deploy`

**Signals:** worries, concerns, what scares you, biggest risk, what would you fix first (informational), qué te preocupa.

**Example phrases:**

- What worries you about my application?
- What's the biggest problem?
- What would stop you from shipping?

**Response:** Top 3 from verdict priorities — not full finding list.

---

### `WHAT_CHANGED` → `what_changed`

**Signals:** changed, broke, improved, regressed, score drop, latest vs previous, qué cambió.

**Example phrases:**

- What changed since last time?
- Did I break anything?
- Why did my score go down?

---

### `FIX` → `safe_fix`

**Signals:** fix, safe fix, cursor prompt, how do I fix, solve, repair, arreglar, this problem (with context).

**Example phrases:**

- Fix this problem.
- How do I fix the auth issue?
- Give me the Cursor prompt for the top blocker.
- Apply Safe Fix. *(user language — tool returns prompt)*

**Pre-step:** If blocker unclear → `can_i_deploy` first or list blockers in safe_fix choose mode.

---

### `REVIEW_NOW` → `review_now`

**Signals:** review, scan, analyze, protect, check latest, inspect, investigate (when fresh data needed), review again, re-scan.

**Example phrases:**

- Protect my application.
- Review my SaaS.
- Review my project.
- Review again.
- Investigate this issue. *(when user wants fresh analysis)*
- Run a production review.
- Check my latest commit.

**`reason` metadata:** `before_deploy` | `after_fix` | `manual_check`.

---

### `HEALTH` → `production_history` + optional `can_i_deploy`

**Signals:** healthy, health, trend, improving, history, evolution, over time, last week.

**Example phrases:**

- How healthy is my application?
- Am I improving?
- Show me how we've been doing.

**Compose:** Current state from `can_i_deploy`; trend from `production_history` — **one merged message** from host.

---

### `WOULD_YOU_DEPLOY` → `can_i_deploy`

**Signals:** your company, if you were me, would you ship, bet your company.

**Example phrases:**

- Would you deploy this if it was your company?
- Would you bet your startup on this release?

**Opinion lead required** (doc 03).

---

## Ambiguous intents

| Phrase | Resolution |
|--------|------------|
| “Check my app” | One clarifying question: deploy readiness vs fresh review |
| “I'm done coding” | Confirm → `review_now` |
| “Is it ok?” | Default `can_i_deploy` if verdict exists; else `review_now` |
| “Help” | Suggest: “Ask ‘Can I deploy?’ or ‘Protect my application.’” |

**Weak signals:** Server instructions already require one confirmation before compute-heavy tools.

---

## Compound intents (ordered sequences)

| User phrase | Sequence |
|-------------|----------|
| Review and tell me if I can deploy | `review_now` → `can_i_deploy` |
| Can I deploy? If not, fix | `can_i_deploy` → `safe_fix` |
| What changed and what should I fix? | `what_changed` → `safe_fix` |
| Protect my app and tell me worries | `review_now` → `can_i_deploy` |
| How healthy am I and can I deploy? | `production_history` → `can_i_deploy` |

Host should **merge** into one SequrAI-voiced reply when possible.

---

## Negative examples (do NOT route)

| User phrase | Wrong tool | Right approach |
|-------------|------------|----------------|
| Write me a login page | any SequrAI tool | Decline gently — general coding |
| Explain Kubernetes | any | Out of scope |
| Run npm test | any | Out of scope |

SequrAI MCP is **production & protection only**.

---

## Evaluation

Existing dataset: `server/mcp/evaluation/intent-dataset.ts` — extend with protection phrases (`am I protected`, `what worries you`) in **implementation sprint after docs**; not in this doc sprint.

**Target:** ≥ 95% correct tool on eval set for deploy vs review vs fix.

---

## i18n

Mirror intent signals in Spanish in `INTENT_SIGNAL_DICTIONARY` (already partial) — full parity in implementation.

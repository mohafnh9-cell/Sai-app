# SequrAI Product Layers

Four layers stack from immediate deploy protection to autonomous, approval-gated action. Hybrid V1 ships Layers 1–3 fully and Layer 4 in approval-gated form.

---

## Layer 1 — Protection Before Deploy

### Responsibilities

- Answer: **Can I ship? Would I ship this?**
- Run structured reviews (security, production, reliability, AI safety).
- Produce Production Verdict + confidence scores + attack surface V1.
- Offer Safe Fix and Review Again before merge/deploy.

### Features (Hybrid V1)

Production Verdict, `review_now`, `can_i_deploy`, `safe_fix`, domain reviews, deployment/security confidence, attack surface V1 (static).

### User experience (web)

- Onboarding → connect GitHub → first protection run.
- Project page: **Protection status**, confidence, top worries, Safe Fix CTA—not “scan results table” as hero.
- Billing and settings only; no deep workflow.

### MCP experience

Primary workflow. User asks deploy/protect/review/fix in natural language; five tools + prompts route intents (see doc 05).

### Architecture requirements

- GitHub integration, scan job pipeline, verdict engine, idempotent side effects.
- Sub-2-minute first verdict P95 (async OK with clear progress in MCP).

### Future roadmap

- Pre-deploy **policy packs** (“my stack is Stripe + Supabase + Vercel”).
- Deploy hooks (block CI on NO-GO) — architecture only in V1.

---

## Layer 2 — Continuous Protection

### Responsibilities

- Answer: **Am I still protected? What changed? What should worry me?**
- Scheduled checks after deploy.
- Alerts when material risk appears.
- Weekly/monthly summaries.

### Features (Hybrid V1)

Daily check job, weekly summary, monthly report, alerts V1, production health V1, dependency V1, attack surface evolution V1, behaviour rules V1.

### User experience (web)

**Protection Dashboard:** protected yes/no, last check, confidence trend, recent alerts, link to monthly report.

### MCP experience

- “Am I protected?” → composite status.
- “What changed?” → `what_changed`.
- “How healthy is my application?” → health narrative + scores.
- “Show my protection status.”

### Architecture requirements

- Scheduler (Inngest cron + scan jobs).
- Alert idempotency + notification channels.
- Diff engine vs last stored verdict/findings.

### Future roadmap

- Custom check frequency per plan (still one plan Year 1; architecture for tiers).
- Slack/Discord alert channels (if not in V1 ship, backlog).

---

## Layer 3 — Production Memory

### Responsibilities

- Remember everything protection-related per project.
- Power moat: SequrAI knows *this* app’s history.
- Feed reports, MCP history tools, and confidence trends.

### Features (Hybrid V1)

Timeline, confidence history, recommendations history, deploy events (manual or GitHub push correlation).

### User experience (web)

Timeline + trend charts on Protection Dashboard.

### MCP experience

- `production_history` — narrative of protection over time.
- `what_changed` — delta since last memory snapshot.

### Architecture requirements

- Append-only event store (Postgres tables; see doc 07).
- No PII/secrets in memory payloads.
- Retention policy (12 months minimum for reports).

### Future roadmap

- Cross-project patterns for same founder (opt-in).
- Export for investors (“our app was continuously protected”).

---

## Layer 4 — Autonomous Protection

### Responsibilities

- Close the loop: **Detect → Explain → Recommend → Fix → Verify → Protect**.
- Never act on production without explicit user approval in V1.

### Features (Hybrid V1)

Safe Fix, diff/PR generation, approval UI, verify via review again, rollback recorded in memory.

### User experience (web)

“Inbox” of suggested fixes awaiting approval; one-click open PR.

### MCP experience

- “Fix this problem” → `safe_fix` → optional “open PR” follow-up flow (web completes approval).

### Architecture requirements

- GitHub App scopes for PR creation.
- Idempotency keys per fix attempt.
- Verification scan triggered after merge.

### Future roadmap

- Auto-apply low-risk fixes with explicit opt-in (not V1).
- Agent orchestration across multiple repos (backlog).

---

## Layer interaction

```
Layer 1 ──writes──► Layer 3 (Memory)
Layer 2 ──reads───► Layer 3
Layer 2 ──triggers► Layer 1 (review jobs)
Layer 4 ──reads───► Layer 1 findings
Layer 4 ──writes──► Layer 3 (fix outcomes)
All layers ──feed──► Alerts & Reports
```

---

## Scaling note

Layers 1–2 scale with **job throughput** and **memory write volume**. Layer 4 scales with **GitHub API** and human approval rate—not autonomous prod traffic.

See [09-technical-architecture.md](./09-technical-architecture.md).

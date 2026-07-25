# Release Milestones

**Environments:** Staging → Production (Private Beta USA).

---

## R0 — Documentation lock (complete)

**Date:** 2026-07-24  
**Deliverable:** Product bible + layer specs + this roadmap.  
**Rule:** Implementation follows roadmap only.

---

## R1 — Staging ready (S1 exit)

| Milestone | Criteria |
|-----------|----------|
| Migrations applied staging | Preflight pass |
| Inngest functions synced | scan-run, recovery, CP batch stubs |
| Scenarios A–L executed | Documented in phase1-6 results |
| 48h soak | Per soak plan |
| `release:verify` | Pass on Node 22 |

**Not:** Public beta.

---

## R2 — Production jobs cutover (S1–S2)

| Milestone | Criteria |
|-----------|----------|
| Async scheduler prod | Allowlist → full rollout |
| Ops alerts | Health polling + log drains |
| Rollback tested | inline scheduler flag |

**Gate for beta users on prod:** R2 complete.

---

## R3 — MCP + onboarding release (S2)

| Milestone | Criteria |
|-----------|----------|
| MCP production | Five tools, updated instructions |
| Onboarding v2 | Finale + Cursor step (ux-sprint) |
| Landing copy | Protection positioning |

**Audience:** Cohort 0 only.

---

## R4 — Memory release (S3)

| Milestone | Criteria |
|-----------|----------|
| Memory writes prod | Events + snapshots |
| MCP history/diff | Beta quality |

**Audience:** Cohort 0 expanded.

---

## R5 — **Private Beta 25** (S4)

| Milestone | Criteria |
|-----------|----------|
| Continuous Protection prod | Daily + default ON |
| Status machine | Four states |
| Invite system | 25 cap |

**Marketing:** Invite-only waitlist USA.

---

## R6 — Alerts release (S5)

| Milestone | Criteria |
|-----------|----------|
| In-app alerts | Urgent/Important |
| Dedupe live | noise monitoring |

**Prerequisite for R7 (100 users).**

---

## R7 — **Private Beta 100** (S6)

| Milestone | Criteria |
|-----------|----------|
| Weekly summary | In-app |
| Cohort 1 exit | Documented |

---

## R8 — Monthly reports release (S7)

| Milestone | Criteria |
|-----------|----------|
| First monthly send | All eligible projects |
| Archive UI | Minimal list OK until S10 |

---

## R9 — **Private Beta 300** (S8)

| Milestone | Criteria |
|-----------|----------|
| Verify loop | fix_verified |
| Safe Fix hero | All NO-GO paths |

---

## R10 — PR remediation release (S9)

| Milestone | Criteria |
|-----------|----------|
| Approved PR path | Audit trail |
| GitHub scope upgrade | Documented for users |

---

## R11 — **Private Beta 500** (S10)

| Milestone | Criteria |
|-----------|----------|
| Protection Center | Hero + timeline lite |
| Reports archive | Linked from center |

---

## R12 — Scale release (S11)

| Milestone | Criteria |
|-----------|----------|
| 10k enqueue test | Pass |
| Dependency V1 | Critical advisory path |

**Prerequisite for 1k cohort stress.**

---

## R13 — **Private Beta 1,000** + billing (S12)

| Milestone | Criteria |
|-----------|----------|
| Stripe single plan | Live |
| User cap | 1,000 enforced |
| Roadmap complete | All SHIPS NOW mapped in [07](./07-feature-to-sprint-map.md) |

**End state:** Private Beta USA at 1,000 users — **Hybrid V1 implementation roadmap complete**.

---

## Public launch (out of scope for this roadmap)

Requires separate release milestone after R13 — see beta strategy cohort 5 notes.

---

## Release discipline

- No cohort open without **release milestone + beta exit** both green.  
- Hotfixes allowed; **features** only via sprint map amendment.

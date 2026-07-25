# Founder Experience Specification

**Purpose:** How alerts **feel** in a founder’s week — not feature lists.

**Goal:** *“When SequrAI emails me, I pay attention — because most days I hear nothing.”*

---

## Personas

| Persona | Alert expectation |
|---------|-------------------|
| **Solo Cursor founder** | In-app + optional email; acts via MCP Safe Fix |
| **Technical co-founder** | Reads detail diff; still wants one CTA |
| **Non-technical founder** | Never sees CVE; trusts worry + action |

---

## A good week (silent protection)

| Day | Founder | SequrAI |
|-----|---------|---------|
| Mon–Sat | Ships features | Daily checks → Memory only |
| Sun | Opens Protection Center | *PROTECTED · Last checked today · 97% / 98%* |
| — | No inbox items | Weekly summary arrives: *Quiet week* |

**Emotion:** Calm confidence — *someone watched while I built.*

---

## A bad week (material change)

| Day | Event | Founder experience |
|-----|-------|-------------------|
| Tue | New public route | **Urgent** in-app + email: worry / changed / Safe Fix |
| Tue PM | Applies fix in Cursor | — |
| Wed | `review_now` | Timeline: fix verified — alert auto-resolved |
| Thu | Daily silent | — |

**Emotion:** Grateful interruption — *caught before customers hit it.*

---

## A noisy week (what we avoid)

| Anti-pattern | Design counter |
|--------------|----------------|
| 7 emails for 7 daily mediums | BD-02 → weekly only |
| 3 emails for 3 NO-GO checks | AT-11 digest + BD-04 weekly |
| CVE newsletter | Plain language only |
| “All clear” daily email | Forbidden |

---

## Should I worry? — decision card

Founders mentally map:

| Alert severity | Worry |
|----------------|-------|
| Urgent | Stop and fix today |
| Important | Fix before next deploy |
| Weekly digest | Plan this week |
| Silence | No |

Protection Center **status line** confirms between alerts:

> *PROTECTED* vs *REQUIRES ATTENTION*

---

## What changed? — trust

Alerts must match what MCP says when asked *“what changed?”* same day — same snapshot id.

Mismatch destroys trust faster than missed alerts.

---

## What should I do next? — one path

| CTA | When |
|-----|------|
| Apply Safe Fix | Finding has open recommendation |
| Review again | After fix or config change |
| Resume protection | CP paused |
| Reconnect GitHub | AT-10 |

**No** alert with three equal buttons.

---

## Notification settings journey

1. Onboarding: in-app ON, explain silence-is-success.  
2. After first Urgent resolved: optional prompt — *Email me when something urgent happens* (not on signup spam).  
3. Settings: simple two toggles (doc 04).

---

## Relationship to MCP

Founders may **never open inbox** if they live in Cursor:

- Same content must be reachable via *“Should I worry?”* → `can_i_deploy`  
- *“What changed?”* → `what_changed`  

Inbox is for co-founders and email-first users.

---

## Success signals (qualitative)

- “SequrAI only bothers me when it matters.”  
- “I don't read security emails from anyone else anymore.”  
- Email left ON after 30 days.

---

## Acceptance criteria

- User test: founder correctly states worry level from alert in &lt; 10s.  
- Post-alert survey optional: ≥ 70% “helpful” for Urgent.

# Alert UX Specification

**Purpose:** How alerts **look, read, and resolve** in the product — inbox, badges, email, and Protection Center — without becoming a SOC dashboard.

---

## Surfaces

| Surface | Role |
|---------|------|
| **Alert inbox** | Project-scoped list; global entry from nav badge |
| **Protection Center banner** | Latest unresolved Urgent/Important |
| **Portfolio dot** | Any project with unread Urgent/Important |
| **Email** | Same content as in-app card, single CTA |
| **Timeline** | Merged episode — not duplicate of inbox row |

**No** separate “Security Alerts” nav with CVE tables.

---

## In-app inbox

### Layout

```
┌─ Alerts ─────────────────────────────────────┐
│  [All] [Needs action]                         │
├───────────────────────────────────────────────┤
│ ● Urgent · 2h ago                               │
│   Something important changed                   │
│   New route without auth — confidence dropped   │
│   [ Apply Safe Fix ]                            │
├───────────────────────────────────────────────┤
│ ○ Important · Yesterday                       │
│   Attack surface increased                      │
│   [ Open protection ]                         │
└───────────────────────────────────────────────┘
```

### Sort order

1. Unread Urgent  
2. Unread Important  
3. Read Urgent/Important  
4. Digest items hidden from inbox — **weekly card only** (doc 08)

### Row anatomy

| Element | Rule |
|---------|------|
| Severity pill | Founder label (doc 03) |
| Title | `titlePlain` — max 60 chars |
| Subtitle | One-line “what changed” |
| CTA | One primary button |
| Dismiss | Secondary — records `dismissedAt`, does not delete Memory |

---

## Alert detail view

Structured **three blocks** (philosophy doc 01):

```
Should you worry?
Yes — I'd fix this before your next deploy.

What changed:
• {bullet 1}
• {bullet 2}

What to do next:
Apply Safe Fix for rate limiting on /api/*
[ Apply Safe Fix ]  [ Copy fix for Cursor ]
```

**Footer:** Link to `what_changed`-equivalent diff in app (precomputed copy, not raw JSON).

---

## Protection Center integration

- **Banner:** Show only if unread Urgent/Important exists  
- **Dismiss banner** marks alert read — does not hide status regression  
- Hero status (PROTECTED / etc.) **stays** until fix + review improves state

---

## Email UX

| Rule | Detail |
|------|--------|
| From | SequrAI &lt;alerts@…&gt; |
| Subject | `{Project}: Something needs attention` (Urgent) / `…worth a look` (Important) |
| Body | Same three blocks; one CTA deep link |
| Frequency cap | Max **1 email per project per day** (dedupe) |
| Unsubscribe | Per-user email channel; in-app remains |

**No** daily “all clear” emails.

---

## Empty states

| State | Copy |
|-------|------|
| No alerts ever | *When something important changes, I'll tell you here. Until then, silence means you're protected.* |
| All read | *You're caught up.* |
| CP paused | *Alerts are quiet because protection is paused.* |

---

## Accessibility

- Severity not color-only (icon + text)  
- CTA is real button, not whole-row click-only  
- Email plain-text alternative with same three blocks  

---

## Settings (Protection Center)

| Toggle | Default (beta / paid) |
|--------|------------------------|
| In-app alerts | ON / ON |
| Email alerts | OFF / ON |
| Positive weekly only | N/A — part of weekly summary |

Pause CP → show AT-09 once; no settings gray-out trick.

---

## Acceptance criteria

- Unread badge count = Urgent + Important unread only.  
- One primary CTA per alert detail.  
- No CVE ID in title or subject line (lint rule).

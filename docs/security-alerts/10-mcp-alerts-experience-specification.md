# MCP Alerts Experience Specification

**Constraint:** **No alert tool.** No sixth MCP tool. Alerts are **surfaced through conversation** via existing tools reading Memory + latest verdict.

---

## Design intent

Founders in Cursor should not open the web inbox for every worry:

| Alert question | MCP tool | Behavior |
|----------------|----------|----------|
| Should I worry? | `can_i_deploy` | Opinion + status + unread alert summary if any |
| What changed? | `what_changed` | Same diff as alert body |
| What should I do next? | `can_i_deploy` → `safe_fix` | Same CTA as alert |

**Parity rule:** If an Urgent alert is unread, MCP opening line must acknowledge it.

---

## Should I worry?

### Tool: `can_i_deploy` (composite)

```
Yes — something needs attention.

I'm worried about:
• {same bullets as alert AT-xx}

This showed up during today's protection check.

Recommended action:
Apply Safe Fix.
```

When **no** open alerts and PROTECTED:

```
No — nothing urgent.

Your application is: PROTECTED
Last checked: {time}

{Optional mild worry from verdict, not from alert system}
```

**Do not** say: “You have 1 unread notification.”  
**Do** say: “Something important changed…”

---

## What changed?

### Tool: `what_changed`

Must match alert `bodyPlain` diff when alert fired same snapshot:

```
Since your last review:
• {bullets}

This is why I alerted you today.
```

If user asks before daily completes:

```
Today's scheduled check is still running — here's the latest from {yesterday}.
```

---

## What should I do next?

| Situation | Tool sequence |
|-----------|---------------|
| Alert linked to recommendation | `safe_fix` |
| Config/route issue | `safe_fix` or review prompt |
| Needs fresh scan after fix | `review_now` after user applies fix |
| CP paused | Resume guidance — no tool for settings; link web |

Bundled prompt `prepare_for_deploy` unchanged (mcp-product doc 08).

---

## Proactive MCP (host instructions)

Hosts **should not** poll alert API on every message.

**Do** suggest check when:

- User says “I got an email from SequrAI”  
- User says “should I worry”  
- User returns after 24h away  

Route → `can_i_deploy` first.

---

## Alerts MCP must not do

- Claim real-time attack or intrusion  
- List CVE IDs as primary content  
- Trigger new scans disguised as “alert check” without `review_now`  
- Expose `alertKind` enum or dedupe keys  

---

## Weekly / monthly in MCP

| User | Tool |
|------|------|
| How was my month? | `production_history` (30d) |
| Summarize alerts this week | `production_history` — not inbox API |
| Send me monthly report | Web/settings — MCP explains where to find archive |

---

## Memory events

MCP read path may include **count** of `alert_sent` in `production_history` highlights:

> *This month I reached out twice — both times about deploy readiness.*

Never dump raw `alert_sent` rows.

---

## Conversation examples

**Founder:** Should I worry about that email?

**SequrAI (`can_i_deploy` + context):**

```
Yes — briefly. A new public route doesn't have auth yet.

What changed:
• Route /api/export added without middleware

What to do next:
Apply Safe Fix, then ask me to review again.
```

**Founder:** What changed since yesterday?

**SequrAI (`what_changed`):**

```
Since yesterday:
• That same route was added
• Production confidence 94% → 86%

I sent you an alert because this is material.
```

---

## Eval intents (implementation follow-up)

Add to MCP intent dataset:

- `should I worry about the email` → can_i_deploy  
- `did you alert me` → can_i_deploy / production_history  
- `why did you email me` → what_changed  

---

## Acceptance criteria

- Same snapshot: alert detail text ≡ MCP `what_changed` bullets (automated string test).  
- Unread Urgent mentioned in first 2 lines of `can_i_deploy` when user asks worry-adjacent phrases.  
- No new tools in OpenAPI/MCP manifest.

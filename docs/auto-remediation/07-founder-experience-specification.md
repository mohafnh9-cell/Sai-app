# Founder Experience Specification

**Purpose:** Auto remediation feels like a **senior engineer pairing** — not a bot merging to main.

---

## Emotional arc

```
Detect  → "Something worries me"
Explain → "Here's why it matters to your users"
Recommend → "Do this first"
Fix     → "Copy fix for Cursor" or approved PR
Verify  → "Check again"
Protect → "You're protected again"
```

Founder never learns: CVE, patch Tuesday, CI pipeline jargon — unless they open Technical Details.

---

## Primary journey (Cursor-first)

| Step | Founder | SequrAI surface |
|------|---------|-----------------|
| 1 | *Can I deploy?* | NO-GO + worries |
| 2 | *Fix this* | MCP `safe_fix` or **Copy fix for Cursor** |
| 3 | Paste in Composer | — |
| 4 | *Review again* | MCP `review_now` |
| 5 | *Am I protected?* | GO / PROTECTED narrative |

**Web** mirrors same steps on onboarding finale + Protection Center.

---

## Secondary journey (PR path)

| Step | Surface |
|------|---------|
| Preview diff | Protection Center |
| Approve PR | Confirm dialog |
| Review in GitHub | Native |
| Merge | User |
| Review again | MCP / web |

Gap between PR open and merge: copy reminds *not protected yet*.

---

## Detect & explain (before fix)

On NO-GO screen **above** fix card:

```
What worries me most:
• {title — plain}

Why it matters:
• {one sentence user impact}
```

No separate “Detect” screen — verdict hero IS explain.

---

## Celebrate progress

| Moment | Micro-celebration |
|--------|-------------------|
| Copied fix | Green check *Copied — paste in Cursor* |
| PR opened | *PR ready for your review* |
| fix_verified | *Nice — that blocker is cleared* |
| PROTECTED restored | Same voice as MCP Protect |

---

## Failure empathy

| Situation | Tone |
|-----------|------|
| Low fix confidence | *I'd double-check this one* |
| Fix didn't work | *Let's try a different approach — I'm still here* |
| PR failed | *GitHub hiccup — here's the prompt instead* |

---

## Settings & trust

- GitHub write scope explained at PR connect: *Only used when you approve a PR*  
- No toggle “auto-fix” in V1 — **backlog** only with explicit opt-in (doc 10)

---

## Relationship to reports

Monthly **Critical issues addressed** = verified fixes — reinforces value of Verify step.

---

## Acceptance criteria

- User test: founder completes prompt path without reading docs.  
- NO-GO screen shows Tier-1 fix card (ux-sprint 03).  
- Zero copy implying SequrAI deployed for them.

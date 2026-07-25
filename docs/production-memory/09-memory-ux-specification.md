# Memory UX Specification

**Purpose:** How founders **feel** Production Memory — long-term protection, not a history product.

**North star feelings:**

> *SequrAI knows my application better than I do.*  
> *My application has been continuously protected for 327 days.*

**Aesthetic target:** **Apple · Cursor · Linear · Vercel** — calm, typographic, one primary action.

**Anti-patterns:** **Jira · Datadog · AWS console · cybersecurity dashboards** — no dense tables, no orange alert wall, no service map.

---

## Design language

| Principle | Apple/Cursor/Linear/Vercel | Avoid |
|-----------|----------------------------|-------|
| Hierarchy | One hero metric + 3 bullets | 12 widgets |
| Color | Neutral surface + one accent | Severity rainbow |
| Motion | Subtle fade on update | Blinking badges |
| Density | Generous whitespace | Scan result grids |
| Copy | First person SequrAI | Passive CVE voice |
| Nav | Home → app → Protection | Security / Timeline / AI Fixes tabs |

**Typography:** Status line large; confidence secondary; dates relative.

**Components:** Rounded card, single primary button, sparkline as thin line (Vercel-style chart).

---

## Dashboard experience (Home / portfolio)

Memory informs list rows — **not** a dedicated memory dashboard.

| Element | Memory-backed |
|---------|---------------|
| Sort | protection_status severity |
| Row subtitle | Top worry OR *Protected 45d* |
| Badge | Four states |
| Avoid | Sparklines on list |

Feels like **Linear**: scannable, calm.

---

## Protection Center experience

1. **30-second headline block** ([08](./08-protection-timeline-specification.md))  
2. Status + worries + recommendation  
3. Sparkline toggle  
4. Weekly memory card  
5. Timeline lite  

Feels like **Vercel**: one project, one story.

---

## Timeline experience

Summary stats first; episodes second — **Apple Health** pattern, not Jira activity.

---

## Design principles

1. **Story over events** — Timeline lite, not event debugger.
2. **Now over history** — Hero = status + worries + one action; history supports trust.
3. **Numbers serve opinion** — Confidence % secondary to PROTECTED / REQUIRES ATTENTION.
4. **Same truth everywhere** — Protection Center, weekly email, MCP share one snapshot id.
5. **No jargon** — Avoid CVE, CVSS, scan, posture, SIEM.

---

## Surfaces

| Surface | Memory domains shown | Primary doc |
|---------|---------------------|-------------|
| Protection Center | Status, confidence sparklines, worries, recommendation, timeline lite, weekly card | [../continuous-protection/08-protection-center-specification.md](../continuous-protection/08-protection-center-specification.md) |
| Portfolio home | Status badge + one worry; no charts | ux-sprint 05 |
| Weekly email / in-app | Weekly rollup | CP doc 03 |
| Monthly report | Full metrics narrative | bible 06 |
| Settings | CP on/off, retention notice | — |

**Hide as primary nav:** legacy Security table, empty Timeline tab, AI Fixes — fold into Protection Center (ux-sprint 07).

---

## Information architecture (project page)

```
1. Protection status hero          ← status machine + latest snapshot
2. Production / Security confidence ← docs 04–05 sparklines
3. Things that worry me             ← latest verdict
4. Recommendation                   ← doc 06 open item
5. This week                        ← weekly memory
6. Protection timeline (lite)       ← doc 08
7. Settings: Continuous Protection
```

**Progressive disclosure:**

- “Past fixes” → recommendations history
- “Deploy checks” → deployment history (doc 03)
- “Details for engineers” → **backlog** (collapsed findings table optional later)

---

## Copy patterns

| Instead of | Use |
|------------|-----|
| Scan completed | Protection review completed |
| 3 vulnerabilities | *This worries me about your app* |
| Finding #4421 | Plain title |
| Event log | Protection timeline |
| Historical data | *Your story with SequrAI* |

---

## Empty & first-run states

| State | UX |
|-------|-----|
| No reviews yet | Hero NOT PROTECTED + “Run first protection review” |
| Review in progress | “I'm learning your application…” |
| CP on, silent week | “Checked daily — nothing material changed” |
| Gap in data (outage) | Honest gap in sparkline + “check delayed” |

---

## Multi-project memory

Portfolio sorts by **protection status** (CP doc 04), not by highest CVE count.

Row memory:

- One worry line from latest snapshot
- Last checked relative time

No cross-project timeline in V1.

---

## Accessibility & mobile

- Status text + icon — not color alone
- Sparklines have tabular fallback (current % + 7d delta)
- Timeline tappable rows expand subtitle only — no nested tables

---

## Founder journeys

### “I forgot what we fixed”

Protection Center → Past fixes → verified list  
Or MCP: *“What did we fix last month?”* → `production_history`

### “Is SequrAI actually watching?”

Last checked + 7/7 checks in weekly card  
Or MCP: *“Am I protected?”* → `can_i_deploy`

### “Pitch deck proof”

Monthly report link + export (ship) — timeline screenshot optional

---

## What Memory UX is not (V1)

- Full-text search across events
- Custom dashboards
- Comparing two projects side-by-side
- Download raw JSON export (backlog — due diligence export in doc 11)

---

## Acceptance criteria

- User test: find “what worries SequrAI” in &lt; 5s on Protection Center.
- Sparkline + hero status from same `snapshotId` in API contract tests.
- No primary nav item labeled “Memory” or “Timeline” without content.

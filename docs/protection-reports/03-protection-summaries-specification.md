# Protection Summaries Specification

**Purpose:** The **hero narrative** across weekly, monthly, and Protection Center — one coherent “protection story” block.

---

## Summary layers

| Layer | Horizon | Surface |
|-------|---------|---------|
| **Now** | Latest snapshot | Protection Center hero |
| **Week** | 7 days | Weekly report |
| **Month** | 30 days | Monthly report |
| **Quarter** | 90 days | MCP `production_history` only (V1) |

All layers share the **same status vocabulary** (doc 04 CP): PROTECTED / SAFE WITH CAUTION / REQUIRES ATTENTION / NOT PROTECTED.

---

## Summary components

Every protection summary includes:

| Component | Content |
|-----------|---------|
| **Status headline** | Four-state label |
| **Protection sentence** | Am I becoming more protected? (yes/no/caution + why) |
| **Watch proof** | Checks completed / last checked |
| **Confidence footnote** | Two numbers max — not a table |
| **Worries teaser** | Top 1 for weekly; top 3 for monthly |

---

## Narrative templates

### Becoming more protected — **Yes**

> *This {week|month}, continuous protection stayed on. Confidence {rose|held steady} and we verified {n} fix(es). You're in a stronger place than when we started.*

### **Caution**

> *I'm still protecting your app, but {one worry} keeps me from calling this fully comfortable. Addressing it should be your next move.*

### **No / regression**

> *Protection {was paused|couldn't run} for part of this period. Until checks run again, I can't stand behind the same level of cover.*

---

## Protection summary vs scanner summary

| Scanner (avoid) | SequrAI summary |
|-----------------|-----------------|
| 12 new issues | *One new route worried me* |
| Grade B+ | *SAFE WITH CAUTION* |
| Scan count | *Daily checks completed: 28/30* |

---

## Cross-surface consistency

| Surface | Must match |
|---------|------------|
| Weekly email | Weekly in-app card |
| Monthly PDF | Monthly email |
| MCP `can_i_deploy` | Latest snapshot status line |
| Alert body | Same worry strings as summary |

Single **content snapshot id** per generation run.

---

## Protection summary in monthly opener

First 120 words of monthly report = expanded protection summary answering **Am I becoming more protected?** before statistics.

---

## Acceptance criteria

- Summary generator unit-tested per status trajectory (up/down/flat/paused).  
- No summary ships without “last checked” or explicit pause honesty.

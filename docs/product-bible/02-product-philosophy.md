# SequrAI Product Philosophy

**Purpose:** Define how protection flows through the builder’s lifecycle and why it never stops at deploy.

---

## The old mental model (rejected)

```
Build → Review → Deploy → (hope)
```

Review was a **gate** once. After deploy, the user was alone. Scans were transactions. Value ended at merge.

---

## The SequrAI model

```
Build with AI
      ↓
   Protect          ← intent: “start caring about this project”
      ↓
   Review           ← structured understanding (security, production, reliability, AI safety)
      ↓
    Fix             ← Safe Fix, approval-gated changes
      ↓
   Deploy           ← only when confidence allows
      ↓
   Protect          ← continuous mode ON (default)
      ↓
   Monitor          ← scheduled checks, diffs, dependencies, surface evolution
      ↓
   Alert            ← when confidence drops or new risk appears
      ↓
  Improve           ← review again, verify fixes, update memory
      ↓
Stay Protected      ← ongoing peace of mind
```

Protection is a **loop**, not a step.

---

## What “Protect” means

**Protect** is not a scan button. It is a commitment:

- SequrAI takes responsibility for *watching* this application on the user’s behalf.
- The user sees **status** (protected / not yet / action needed), not raw telemetry.
- Every review, fix, and deploy updates **Production Memory**.

**Before deploy:** Protect = “make this safe to ship.”  
**After deploy:** Protect = “make sure it stays safe as the world and codebase change.”

---

## Why protection never stops after deployment

AI-built software changes constantly:

- New AI-generated commits.
- New dependencies.
- New endpoints and integrations.
- New production incidents (even small ones).

A one-time verdict ages in **days**. Founders don’t fail at first deploy—they fail when **nobody is watching** afterward.

SequrAI’s job is to be that watcher: calm, continuous, explainable.

---

## User questions we optimize for

| Deprecated | Canonical |
|------------|-----------|
| What vulnerabilities do I have? | **Am I protected?** |
| Run a scan | **Protect my application** |
| Show findings | **What worries you?** |
| CVE-2024-… | **Can I deploy?** / **Would you deploy this?** |

---

## Trust mechanics

Users trust SequrAI when:

1. **Answers are stable** — Same project state → same protection answer (idempotent reviews where possible).
2. **Actions are single-step** — One obvious next move (Safe Fix, review again, connect repo).
3. **Bad news is kind** — Explain impact in founder language; never shame.
4. **Good news is celebratory** — “You’re protected.” “Ready to ship.”
5. **Memory proves care** — “Last month we prevented 2 unsafe deploys” beats abstract scores.

---

## What we refuse to become

- A dashboard of red/yellow/green widgets with no story.
- A tool that only experts understand.
- A scanner that dumps 200 findings and disappears.
- Fear marketing (“hackers are coming”).

We sell **continuous protection and peace of mind**.

---

## Relationship to the four product layers

See [04-product-layers.md](./04-product-layers.md):

- Layers 1–2 cover the loop before and after deploy.
- Layer 3 (Memory) makes the loop compound.
- Layer 4 (Autonomous Protection) automates the loop with human approval gates in V1.

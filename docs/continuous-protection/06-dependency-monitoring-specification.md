# Dependency Monitoring V1 Specification

**Purpose:** Watch **dependency changes** and **new critical risk** — report **confidence impact** and **one recommendation**. Not a full SCA platform.

---

## Scope (V1)

| In scope | Out of scope |
|----------|--------------|
| npm / pnpm / yarn lockfiles + package.json | Full license policy engine |
| Lockfile diff vs last snapshot | Private registry mirroring |
| New **critical** advisories (OSV or equivalent) | Every severity in daily alerts |
| Confidence impact narrative | Darktrace / runtime dependency behavior |
| Weekly rollup | Auto-bump PRs without approval |

**Ecosystem:** JavaScript/TypeScript monorepos first; others **backlog**.

---

## Daily workflow

1. Fetch lockfile hash at default-branch HEAD (via GitHub).
2. Compare to last `dependency_snapshot` in Memory.
3. If unchanged → skip advisory API calls (cost guardrail).
4. If changed:
   - Parse added/removed/updated packages (names + versions only — no full tree in Memory).
   - Query advisory API for **critical** only on **changed** packages.
5. Write `dependency_snapshot` event.
6. If new critical advisory affecting project → **material change** (doc 01) → alert + status review.

---

## Confidence impact

| Scenario | Confidence adjustment (narrative, not hidden math) |
|----------|-----------------------------------------------------|
| Patch bump, no advisory | *No impact.* |
| New direct dep, no advisory | *Slight caution — new code in your supply chain.* |
| Critical advisory on direct dep | *Security confidence should drop — treat as REQUIRES ATTENTION.* |
| Critical on transitive only | *Mention in worries; status SAFE WITH CAUTION unless exploitable path proven in V1 heuristics.* |

V1 does **not** show CVSS in UI; internal severity drives status rules only.

---

## User experience

### Protection Center block

```
Dependencies
Last change: {date} — {n} packages updated

{No new critical issues | Critical advisory: {name} — affects your app}

Impact on confidence:
{one sentence}

Recommendation:
{Update package | Apply Safe Fix | No action needed}
```

### Weekly summary

Bullet under **Dependencies** section (doc 03).

### Alerts

**Title:** `New dependency risk in {Project}`  
**Body:** plain language + Safe Fix CTA — not CVE list.

---

## Recommendations

Priority order:

1. Safe Fix for upgrade/patch path when known
2. `review_now` after user merges dependency PR
3. Dismiss with recorded reason (Memory: `recommendation_dismissed`) — rare

---

## MCP experience

| User | Tool | Notes |
|------|------|-------|
| Did any dependencies get worse? | `what_changed` | Diff snapshots |
| Am I protected from supply chain issues? | `can_i_deploy` | Composite — not a dep-only scan |
| What should I fix first? | `can_i_deploy` → `safe_fix` | If dep is top worry |

Never expose tool name “dependency monitor.”

---

## Memory payload (example shape)

```json
{
  "lockfileHash": "sha256:…",
  "changedPackages": [{ "name": "lodash", "from": "4.17.20", "to": "4.17.21" }],
  "newCriticalAdvisories": [{ "package": "…", "advisoryId": "…", "summaryPlain": "…" }]
}
```

No full lockfile stored.

---

## Acceptance criteria

- Lockfile unchanged → zero advisory API calls (metric in ops).
- Critical advisory triggers exactly one idempotent alert per advisory per project.
- Founder-facing copy passes “no CVE in headline” lint.

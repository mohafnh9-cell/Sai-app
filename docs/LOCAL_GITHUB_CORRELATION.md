# Local ↔ GitHub Correlation (Phase D.7)

SequrAI can compare **local MCP analysis** findings with **persisted GitHub scan findings** using deterministic, evidence-based identity — not text similarity.

## What correlation means

Correlation answers: “Does this local finding correspond to a finding SequrAI already stored from a GitHub scan for this project?”

It does **not** mean:
- Local analysis is authoritative over GitHub
- Similar titles or descriptions imply a match
- Branch names alone link a local workspace to a PR

**GitHub persisted Production Verdict and scan findings remain authoritative** for remote state.

## Correlation identity

Reuses scanner rule material via:

```
correlationKey = stableHash(ruleId + normalizedRelativePath + fingerprintMaterial)
```

- **Included:** rule ID, repo-relative normalized path, stable rule fingerprint material
- **Excluded:** line number, timestamps, absolute local paths, finding text alone

Stored on new scans in `scan_findings.metadata.correlationKey`.

## States

| Status | Meaning |
|--------|---------|
| `matched` | One open GitHub finding shares the same correlation identity |
| `unmatched` | No safe GitHub counterpart (or insufficient commit evidence) |
| `resolved` | Local no longer reports it; a prior GitHub finding existed |
| `changed` | Same identity, material severity change on GitHub |
| `ambiguous` | Multiple GitHub candidates — never silently pick one |

## Commit / PR evidence

- **Commit:** local `commitSha` must match a completed GitHub scan commit (prefix match allowed).
- **PR:** only when PR `head_commit_sha` equals local commit SHA — never branch name alone.

If local analysis has no commit SHA → explicit **not correlated** (fail closed).

## Surfaces

| Surface | Behavior |
|---------|----------|
| Local MCP (`sequrai_local_audit`) | Each finding includes `correlationKey`; result includes `correlation.ready` |
| API | `POST /api/projects/[id]/local-correlation` (project membership required) |
| Mission Control UI | Paste local audit JSON → compare against GitHub scan for project |

## What is NOT guaranteed

SequrAI does **not** guarantee that every local issue is tracked into GitHub automatically. Correlation requires:

1. Authorized project context
2. Persisted GitHub scan data for the project
3. Matching correlation identity
4. Commit SHA evidence when comparing to GitHub/PR state

## Security

- Tenant isolation via `requireProjectApiAccess`
- No cross-project or cross-org lookup
- No secrets in correlation metadata
- Client-supplied findings are matched only against server-side GitHub data (informational)

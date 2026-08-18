# SequrAI platform prompt-injection guards

Defends **SequrAI's own LLM surfaces** (Production Verdict narrative, Safe Fix prompts, MCP output) from untrusted repository content. This is separate from `features/security-analysis/prompt-injection/`, which scans **the user's application code** as a product feature.

## Layers

| Layer | Module | When |
|-------|--------|------|
| A — Input | `input-guard.ts` | Before repo-derived text enters any SequrAI prompt |
| B — Output | `output-guard.ts` | Before Safe Fix prompts leave via MCP or UI |

## Detection

`input-guard.ts` reuses the proven pattern corpus from `features/security-analysis/prompt-injection/rules-content.ts` (same heuristics as client-side analysis). **LLM Guard** (Python, self-hosted) can replace `scanInjectionPatterns` later via a sidecar adapter without changing call sites.

## Findings

Detections emit `prompt_injection_attempt` findings (`platform.prompt_injection_attempt.*`). They are always low confidence and never upgrade other findings to VERIFIED.

## Delimiters

Untrusted content is wrapped as:

```
<<<SEQURAI_UNTRUSTED_REPOSITORY_DATA source="..." path="...">>>
...content...
<<<END_SEQURAI_UNTRUSTED_REPOSITORY_DATA>>>
```

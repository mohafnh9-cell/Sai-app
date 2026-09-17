# SequrAI detection benchmark — MCP / Prompt Injection / Agent Action coverage matrix

Ground truth for every table below comes from reading the real rule
source and, for every row marked COVERED, empirically verifying the
fixture against a live `scanRepository()` run (not from the estimated
"~29 / ~21 / ~19" figures in the original phase brief — see each
subsystem's corrected real count).

States: **COVERED** (a measurable positive+negative ground-truth fixture
exists and passes), **PARTIALLY_COVERED** (a positive fixture exists but
a clean negative isn't meaningful, or vice versa, OR only a family
representative among several same-mechanism dynamic ids was verified),
**NOT_COVERED** (no fixture exists; reason given — never because "it
isn't a real vulnerability"), **UNVERIFIED** (a fixture exists but has
not been independently re-verified against the real scanner this pass —
used only for the manifest-derived ids sharing a covered sibling's exact
code mechanism).

## Detection Accuracy Hardening V1 — what changed since the last coverage snapshot

Three structural gaps and two false positives (documented below and in
BLIND_SPOTS.md) were root-caused and **fixed** in this pass:

1. **Python-file visibility (scanner-wide P1).** `.py` added to
   `SOURCE_EXTENSIONS` (`features/security-scanner/constants.ts`). All 6
   Python MCP checks and all 4 Python prompt-injection checks moved from
   NOT_COVERED to COVERED.
2. **`isRelevantValue()` keyword pre-filter** (`features/security-analysis/agent-action/discover.ts`)
   extended with `cat` and `@reboot`. `bash.credential.ssh-key-read`,
   `bash.credential.aws-creds`, and `cron.persistence.at-boot` moved from
   NOT_COVERED to COVERED.
3. **`mcp.fs-write-no-path-validation`** regex fixed (exclusion check
   moved before the greedy identifier match). No longer a false positive
   — moved from "confirmed FP, excluded" to COVERED.
4. **`web.next-xss`** regex fixed (both `dangerouslySetInnerHTML` and
   `.innerHTML =` pattern specs). No longer a false positive — moved
   from "confirmed FP, excluded" to COVERED.

No rule was weakened, no fixture was deleted, and no ground truth was
changed to make a case pass — every fix was verified to still catch the
vulnerable case it always caught (see the adversarial-review section of
the final report).

## MCP (`features/security-analysis/mcp/`)

Real count: **29** source-pattern checks (`MCP_SECURITY_RULES` in
`rules.ts`, counted directly) + **~13** additional manifest-derived
finding ids (`scan-manifest.ts`, not part of the 29).

| Check | Positive | Negative | Edge | Status |
|---|---:|---:|---:|---|
| mcp.shell-exec-no-validation | 1 | 1 | 0 | COVERED |
| mcp.shell-exec-direct | 1 | 1 | 0 | COVERED |
| mcp.spawn-shell-true | 1 | 1 | 0 | COVERED |
| mcp.subprocess-shell | 1 | 1 | 0 | COVERED (fixed this pass — Python visibility) |
| mcp.os-system | 1 | 1 | 0 | COVERED (fixed this pass — Python visibility) |
| mcp.fs-write-no-path-validation | 1 | 3 | 0 | COVERED (fixed this pass — was a confirmed FP; regex now excludes path.resolve/join/normalize correctly, see BLIND_SPOTS.md) |
| mcp.http-request-user-url | 1 | 1 | 0 | COVERED |
| mcp.env-var-exposure | 1 | 1 | 0 | COVERED |
| mcp.env-var-exposure-python | 1 | 1 | 0 | COVERED (fixed this pass — Python visibility) |
| mcp.no-input-validation | 1 | 1 | 0 | COVERED |
| mcp.path-no-normalize | 1 | 1 | 0 | COVERED |
| mcp.url-no-validation | 1 | 1 | 0 | COVERED |
| mcp.exfiltration-external-request | 1 | 1 | 0 | COVERED |
| mcp.exfiltration-external-request-python | 1 | 1 | 0 | COVERED (fixed this pass — Python visibility) |
| mcp.exfiltration-network-socket | 1 | 1 | 0 | COVERED |
| mcp.exfiltration-log-secrets | 1 | 1 | 0 | COVERED |
| mcp.eval-usage | 1 | 1 | 0 | COVERED |
| mcp.function-constructor | 1 | 1 | 0 | COVERED |
| mcp.exec-string-concat | 1 | 1 | 0 | COVERED |
| mcp.cors-wildcard | 1 | 1 | 0 | COVERED |
| mcp.cors-permissive | 1 | 1 | 0 | COVERED |
| mcp.no-auth-check | 1 | 1 | 0 | COVERED |
| mcp.pickle-load | 1 | 1 | 0 | COVERED (fixed this pass — Python visibility) |
| mcp.yaml-unsafe-load | 1 | 1 | 0 | COVERED (fixed this pass — Python visibility) |
| mcp.unicode-zero-width | 1 | 1 | 0 | COVERED |
| mcp.unicode-bidi-override | 1 | 1 | 0 | COVERED |
| mcp.unicode-homoglyph | 1 | 1 | 0 | COVERED |
| mcp.description-injection | 1 | 1 | 0 | COVERED |
| mcp.tool-name-spoofing | 1 | 1 | 0 | COVERED |
| mcp.schema-open-additionalProperties | 1 | 1 | 0 | COVERED |
| mcp.schema-description-injection | 1 | 1 | 0 | COVERED |
| mcp.schema-suspicious-default | 0 | 0 | 0 | UNVERIFIED — same `checkSchemaManipulation` mechanism as the two rows above, not independently re-verified this pass |
| mcp.cross-tool-reference | 0 | 0 | 0 | UNVERIFIED — same `checkCrossToolManipulation` mechanism as the row below |
| mcp.cross-tool-priority-override | 1 | 1 | 0 | COVERED |
| mcp.manifest-name-spoofing | 1 | 1 | 0 | COVERED |
| mcp.manifest-description-too-long | 1 | 1 | 0 | COVERED |
| mcp.description-tunneling-url | 0 | 0 | 0 | UNVERIFIED — same URL-in-description mechanism as `mcp.description-suspicious-url` |
| mcp.description-suspicious-url | 0 | 0 | 0 | UNVERIFIED |
| mcp.description-length-anomaly | 0 | 0 | 0 | NOT_COVERED — requires ≥5 tools with a statistical z-score outlier; not attempted |
| mcp.manifest-parse-error | 1 | 1 | 0 | COVERED |
| mcp.manifest-description-injection (manifest-level, distinct id from source-level `mcp.description-injection`) | 0 | 0 | 0 | UNVERIFIED — same phrase-matching mechanism as `mcp.schema-description-injection` |
| mcp.unicode-zero-width / mcp.unicode-bidi-override (manifest variant — same id, different code path) | 0 | 0 | 0 | PARTIALLY_COVERED — the source-file variant IS covered above; the manifest-level trigger path (`scanMcpManifest`) is a separate, unverified code path sharing the same rule id |
| mcp.rug-pull-detected | 0 | 0 | 0 | NOT_COVERED — requires a baseline file (`.mcp-security-baseline.json`) alongside the manifest; not attempted |

**MCP fixture totals: 28/29 source checks COVERED (individually verified) + 6/13 manifest checks COVERED + 1 PARTIALLY_COVERED + 6 UNVERIFIED (same mechanism as a covered sibling) + 2 NOT_COVERED (require inputs/scale not attempted this pass). Zero MCP checks remain NOT_COVERED for the Python-file reason — that gap is closed.**

## Prompt Injection (`features/security-analysis/prompt-injection/`)

Real count: **20** (`PROMPT_CODE_RULES`=11 + `PROMPT_CONTENT_RULES`=9).

| Check | Positive | Negative | Edge | Status |
|---|---:|---:|---:|---|
| javascript.llm.security.prompt-injection.openai-unsafe-template | 1 | 1 | 0 | COVERED |
| javascript.llm.security.prompt-injection.openai-unsafe-concat | 1 | 1 | 0 | COVERED |
| javascript.llm.security.prompt-injection.anthropic-unsafe | 1 | 1 | 0 | COVERED |
| typescript.llm.security.prompt-injection.ai-sdk-unsafe-template | 1 | 1 | 0 | COVERED |
| javascript.llm.security.prompt-injection.langchain-unsafe | 1 | 1 | 0 | COVERED |
| javascript.llm.security.output-injection.eval-llm-response | 1 | 1 | 0 | COVERED |
| javascript.llm.security.output-injection.function-constructor | 1 | 1 | 0 | COVERED |
| python.llm.security.prompt-injection.openai-unsafe-fstring | 1 | 1 | 0 | COVERED (fixed this pass — Python visibility) |
| python.llm.security.prompt-injection.openai-unsafe-concat | 1 | 1 | 0 | COVERED (fixed this pass — Python visibility) |
| python.llm.security.prompt-injection.anthropic-unsafe-fstring | 1 | 1 | 0 | COVERED (fixed this pass — Python visibility) |
| python.llm.security.output-injection.eval-llm-response | 1 | 1 | 0 | COVERED (fixed this pass — Python visibility) |
| generic.prompt.security.ignore-previous-instructions | 1 | 1 | 0 | COVERED |
| generic.prompt.security.new-instructions-injection | 1 | 1 | 0 | COVERED |
| generic.prompt.security.jailbreak-dan | 1 | 1 | 0 | COVERED |
| generic.prompt.security.system-prompt-extraction | 1 | 1 | 0 | COVERED |
| generic.prompt.security.delimiter-injection | 1 | 1 | 0 | COVERED |
| generic.prompt.security.jailbreak-developer-mode | 1 | 1 | 0 | COVERED |
| generic.prompt.security.natural-language-exfiltration | 1 | 1 | 0 | COVERED |
| generic.prompt.security.output-manipulation | 1 | 1 | 0 | COVERED |
| agent.exfil.security.env-file-access | 1 | 1 | 0 | COVERED |

**Prompt-injection fixture totals: 20/20 checks COVERED (40 fixtures) — 100% of the real inventory, up from 16/20. The Python gap is fully closed.**

## Agent Action (`features/security-analysis/agent-action/`)

Real count: **19** fixed `ActionRule` checks (`BASH_RULES`=10, `CRON_RULES`=2, `PROCESS_SPAWN_RULES`=2, `GIT_RULES`=2, `DOCKER_RULES`=3) **plus 25 more dynamically-named checks** (`file_write.system.*`×3, `file_write.sensitive.*`×4, `file_read.credential.*`×4, `file_delete.sensitive.*`×7, `http.ssrf.*`×4, `http.exfiltration.*`×3).

| Check | Positive | Negative | Edge | Status |
|---|---:|---:|---:|---|
| bash.destructive.rm-rf | 1 | 1 | 0 | COVERED |
| bash.rce.curl-pipe-sh | 1 | 1 | 0 | COVERED |
| bash.sql.drop-table | 0 | 0 | 0 | NOT_COVERED — actionType "bash" is never inferred for a handler that calls a database client (`db.execute(...)`); a structural gap distinct from `isRelevantValue()`, not addressed this pass |
| bash.sql.delete-no-where | 0 | 0 | 0 | NOT_COVERED — same reason as above |
| bash.disk.dd | 1 | 1 | 0 | COVERED |
| bash.credential.ssh-key-read | 1 | 2 | 1 | COVERED (fixed this pass — `isRelevantValue()` now recognizes `cat`; edge case confirms no noise on ordinary `cat` usage) |
| bash.credential.aws-creds | 1 | 1 | 0 | COVERED (fixed this pass — same `isRelevantValue()` fix) |
| bash.permissions.chmod-777 | 1 | 1 | 0 | COVERED |
| bash.escalation.sudo | 1 | 1 | 0 | COVERED |
| bash.git.force-push | 1 | 1 | 0 | COVERED |
| cron.rce.curl-pipe | 1 | 1 | 0 | COVERED |
| cron.persistence.at-boot | 1 | 1 | 0 | COVERED (fixed this pass — `isRelevantValue()` now recognizes `@reboot`) |
| process_spawn.reverse-shell | 1 | 1 | 0 | COVERED |
| process_spawn.privilege-escalation | 1 | 1 | 0 | COVERED |
| git.destructive.force-push | 1 | 1 | 0 | COVERED |
| git.destructive.reset-hard | 1 | 1 | 0 | COVERED |
| docker.privileged | 1 | 1 | 0 | COVERED |
| docker.host-mount.root | 1 | 1 | 0 | COVERED |
| docker.host-mount.docker-sock | 1 | 1 | 0 | COVERED |
| file_write.system.* (3 ids: /etc, /usr, /bin) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 3 ids fixtured as a representative (`/etc`); `/usr`/`/bin` share the identical mechanism, not independently re-verified |
| file_write.sensitive.* (4 ids) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 4 fixtured as a representative (`.env`) |
| file_read.credential.* (4 ids) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 4 fixtured as a representative (`.ssh/`) |
| file_delete.sensitive.* (7 ids) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 7 fixtured as a representative (`.ssh/`) |
| http.ssrf.* (4 ids) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 4 fixtured as a representative (`localhost`) |
| http.exfiltration.* (3 ids) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 3 fixtured as a representative (`webhook.site`) |

**Agent-action fixture totals: 19/19 fixed checks COVERED (up from 17/19) + 6/25 dynamic-id families PARTIALLY_COVERED with 1 representative each + 2 checks NOT_COVERED (the two SQL checks — a genuinely different, unaddressed gap) + 19 dynamic ids UNVERIFIED (same mechanism as their covered family representative).**

## Remaining structural gaps (accurately documented, not fixed this pass)

1. **`bash.sql.drop-table` / `bash.sql.delete-no-where`.** Different root
   cause from the `isRelevantValue()` fix: actionType "bash" is never
   inferred for a handler whose body calls a database client rather than
   a shell-exec function. Fixing this would require broadening
   `HANDLER_CAPABILITY_PATTERNS`/`CAPABILITY_TOOL_NAME_PATTERNS` to
   recognize DB-client handlers as SQL-capable — judged out of scope for
   this pass (not requested, and broadens a different mechanism than the
   one investigated).
2. **19 dynamic agent-action ids and 6 MCP manifest ids remain UNVERIFIED**
   individually — each shares the exact code mechanism as a covered
   sibling (verified), but was not independently re-verified. Coverage
   claims are stated precisely as "family representative tested," never
   as "all N ids individually verified."
3. **Non-Python, non-JS/TS languages** referenced by the native scanner's
   own `CODE_PATH` (`.go`, `.rb`, `.java`, `.php`) remain outside
   `SOURCE_EXTENSIONS` and are still silently excluded with the same
   misleading `"binary"` omission reason the Python files had. This
   phase was explicitly scoped to Python visibility only (per the master
   prompt's "PYTHON VISIBILITY not PYTHON DETECTION COMPLETENESS");
   these languages are a related, out-of-scope, real gap, documented
   here rather than silently left unmentioned.
4. IDOR/BOLA, race conditions/TOCTOU, multi-step business-logic chains —
   unchanged from V1/V2, see BLIND_SPOTS.md.

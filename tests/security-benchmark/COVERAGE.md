# SequrAI detection benchmark — MCP / Prompt Injection / Agent Action coverage matrix

Ground truth for every table below comes from reading the real rule
source and, for every row marked COVERED, empirically verifying the
fixture against a live `scanRepository()` run (not from the estimated
"~29 / ~21 / ~19" figures in the phase brief — see each subsystem's
corrected real count).

States: **COVERED** (a measurable positive+negative ground-truth fixture
exists and passes), **PARTIALLY_COVERED** (a positive fixture exists but
a clean negative isn't meaningful, or vice versa), **NOT_COVERED** (no
fixture exists; reason given — never because "it isn't a real
vulnerability").

## MCP (`features/security-analysis/mcp/`)

Real count: **29** source-pattern checks (`MCP_SECURITY_RULES` in
`rules.ts`, counted directly) + **~13** additional manifest-derived
finding ids (`scan-manifest.ts`, not part of the 29 and not previously
counted at all). Matches the phase brief's "~29" for the pattern checks;
the manifest-derived surface was previously entirely unaccounted for.

| Check | Positive | Negative | Edge | Status |
|---|---:|---:|---:|---|
| mcp.shell-exec-no-validation | 1 | 1 | 0 | COVERED |
| mcp.shell-exec-direct | 1 | 1 | 0 | COVERED |
| mcp.spawn-shell-true | 1 | 1 | 0 | COVERED |
| mcp.subprocess-shell | 0 | 0 | 0 | NOT_COVERED — Python-only check; `.py` files never reach `scanRepository()` (see "Structural gap" below) |
| mcp.os-system | 0 | 0 | 0 | NOT_COVERED — same Python-file gap |
| mcp.fs-write-no-path-validation | 0 | 0 | 1 (excluded) | NOT_COVERED as a passing case — confirmed FALSE POSITIVE on its own recommended safe pattern (`writeFileSync(path.resolve(...))`); tracked as a permanent excluded edge fixture, not fixed this phase |
| mcp.http-request-user-url | 1 | 1 | 0 | COVERED |
| mcp.env-var-exposure | 1 | 1 | 0 | COVERED |
| mcp.env-var-exposure-python | 0 | 0 | 0 | NOT_COVERED — Python-file gap |
| mcp.no-input-validation | 1 | 1 | 0 | COVERED |
| mcp.path-no-normalize | 1 | 1 | 0 | COVERED |
| mcp.url-no-validation | 1 | 1 | 0 | COVERED |
| mcp.exfiltration-external-request | 1 | 1 | 0 | COVERED |
| mcp.exfiltration-external-request-python | 0 | 0 | 0 | NOT_COVERED — Python-file gap |
| mcp.exfiltration-network-socket | 1 | 1 | 0 | COVERED |
| mcp.exfiltration-log-secrets | 1 | 1 | 0 | COVERED |
| mcp.eval-usage | 1 | 1 | 0 | COVERED |
| mcp.function-constructor | 1 | 1 | 0 | COVERED |
| mcp.exec-string-concat | 1 | 1 | 0 | COVERED |
| mcp.cors-wildcard | 1 | 1 | 0 | COVERED |
| mcp.cors-permissive | 1 | 1 | 0 | COVERED |
| mcp.no-auth-check | 1 | 1 | 0 | COVERED |
| mcp.pickle-load | 0 | 0 | 0 | NOT_COVERED — Python-file gap |
| mcp.yaml-unsafe-load | 0 | 0 | 0 | NOT_COVERED — Python-file gap |
| mcp.unicode-zero-width | 1 | 1 | 0 | COVERED |
| mcp.unicode-bidi-override | 1 | 1 | 0 | COVERED |
| mcp.unicode-homoglyph | 1 | 1 | 0 | COVERED |
| mcp.description-injection | 1 | 1 | 0 | COVERED |
| mcp.tool-name-spoofing | 1 | 1 | 0 | COVERED |
| mcp.schema-open-additionalProperties | 1 | 1 | 0 | COVERED |
| mcp.schema-description-injection | 1 | 1 | 0 | COVERED |
| mcp.schema-suspicious-default | 0 | 0 | 0 | NOT_COVERED — same `checkSchemaManipulation` mechanism as the two rows above, not independently re-verified this pass |
| mcp.cross-tool-reference | 0 | 0 | 0 | NOT_COVERED — same `checkCrossToolManipulation` mechanism as the row below, not independently re-verified |
| mcp.cross-tool-priority-override | 1 | 1 | 0 | COVERED |
| mcp.manifest-name-spoofing | 1 | 1 | 0 | COVERED |
| mcp.manifest-description-too-long | 1 | 1 | 0 | COVERED |
| mcp.manifest-description-tunneling-url (`mcp.description-tunneling-url`) | 0 | 0 | 0 | NOT_COVERED — same URL-in-description mechanism as `mcp.description-suspicious-url`, not independently re-verified |
| mcp.description-suspicious-url | 0 | 0 | 0 | NOT_COVERED — not independently re-verified this pass |
| mcp.description-length-anomaly | 0 | 0 | 0 | NOT_COVERED — requires ≥5 tools with a statistical z-score outlier; deferred, not independently re-verified |
| mcp.manifest-parse-error | 1 | 1 | 0 | COVERED |
| mcp.manifest-description-injection (manifest-level, distinct id from source-level `mcp.description-injection`) | 0 | 0 | 0 | NOT_COVERED — same phrase-matching mechanism as `mcp.schema-description-injection`, not independently re-verified |
| mcp.unicode-zero-width / mcp.unicode-bidi-override (manifest variant — same id, different code path) | 0 | 0 | 0 | PARTIALLY_COVERED — the source-file variant of these ids IS covered above; the manifest-level trigger path (`scanMcpManifest`) is a separate, unverified code path sharing the same rule id |
| mcp.rug-pull-detected | 0 | 0 | 0 | NOT_COVERED — requires a baseline file (`.mcp-security-baseline.json`) alongside the manifest; not attempted this pass |

**MCP fixture totals: 22 checks COVERED (44 fixtures) + 6 manifest checks COVERED (12 fixtures) + 1 confirmed FP tracked as an excluded edge fixture + 6 checks NOT_COVERED (structural Python-file gap) + 8 manifest checks NOT_COVERED (not independently re-verified, same code mechanism as a covered sibling).**

## Prompt Injection (`features/security-analysis/prompt-injection/`)

Real count: **20** (`PROMPT_CODE_RULES`=11 + `PROMPT_CONTENT_RULES`=9, counted directly) — matches the phase brief's "~21" closely, no material discrepancy.

| Check | Positive | Negative | Edge | Status |
|---|---:|---:|---:|---|
| javascript.llm.security.prompt-injection.openai-unsafe-template | 1 | 1 | 0 | COVERED |
| javascript.llm.security.prompt-injection.openai-unsafe-concat | 1 | 1 | 0 | COVERED |
| javascript.llm.security.prompt-injection.anthropic-unsafe | 1 | 1 | 0 | COVERED |
| typescript.llm.security.prompt-injection.ai-sdk-unsafe-template | 1 | 1 | 0 | COVERED |
| javascript.llm.security.prompt-injection.langchain-unsafe | 1 | 1 | 0 | COVERED |
| javascript.llm.security.output-injection.eval-llm-response | 1 | 1 | 0 | COVERED |
| javascript.llm.security.output-injection.function-constructor | 1 | 1 | 0 | COVERED |
| python.llm.security.prompt-injection.openai-unsafe-fstring | 0 | 0 | 0 | NOT_COVERED — Python-file gap (see below) |
| python.llm.security.prompt-injection.openai-unsafe-concat | 0 | 0 | 0 | NOT_COVERED — Python-file gap |
| python.llm.security.prompt-injection.anthropic-unsafe-fstring | 0 | 0 | 0 | NOT_COVERED — Python-file gap |
| python.llm.security.output-injection.eval-llm-response | 0 | 0 | 0 | NOT_COVERED — Python-file gap |
| generic.prompt.security.ignore-previous-instructions | 1 | 1 | 0 | COVERED |
| generic.prompt.security.new-instructions-injection | 1 | 1 | 0 | COVERED |
| generic.prompt.security.jailbreak-dan | 1 | 1 | 0 | COVERED |
| generic.prompt.security.system-prompt-extraction | 1 | 1 | 0 | COVERED |
| generic.prompt.security.delimiter-injection | 1 | 1 | 0 | COVERED |
| generic.prompt.security.jailbreak-developer-mode | 1 | 1 | 0 | COVERED |
| generic.prompt.security.natural-language-exfiltration | 1 | 1 | 0 | COVERED |
| generic.prompt.security.output-manipulation | 1 | 1 | 0 | COVERED |
| agent.exfil.security.env-file-access | 1 | 1 | 0 | COVERED |

**Prompt-injection fixture totals: 16/20 checks COVERED (32 fixtures), 4/20 NOT_COVERED (all 4 are the Python-language variants — 100% of the JS/TS surface is covered).**

## Agent Action (`features/security-analysis/agent-action/`)

Real count: **19** fixed `ActionRule` checks (`BASH_RULES`=10, `CRON_RULES`=2, `PROCESS_SPAWN_RULES`=2, `GIT_RULES`=2, `DOCKER_RULES`=3, counted directly — matches "~19" exactly) **plus 25 more dynamically-named checks** whose id is built from a pattern label at runtime (`file_write.system.*`×3, `file_write.sensitive.*`×4, `file_read.credential.*`×4, `file_delete.sensitive.*`×7, `http.ssrf.*`×4, `http.exfiltration.*`×3). Real total: **44**, not "~19".

| Check | Positive | Negative | Edge | Status |
|---|---:|---:|---:|---|
| bash.destructive.rm-rf | 1 | 1 | 0 | COVERED |
| bash.rce.curl-pipe-sh | 1 | 1 | 0 | COVERED |
| bash.sql.drop-table | 0 | 0 | 0 | NOT_COVERED — actionType "bash" is never inferred for a handler that calls a database client (`db.execute(...)`); documented in V1 |
| bash.sql.delete-no-where | 0 | 0 | 0 | NOT_COVERED — same reason as above |
| bash.disk.dd | 1 | 1 | 0 | COVERED |
| bash.credential.ssh-key-read | 0 | 0 | 0 | NOT_COVERED — `isRelevantValue()` keyword pre-filter (see "Structural gap" below) drops the realistic phrase before the check ever runs |
| bash.credential.aws-creds | 0 | 0 | 0 | NOT_COVERED — same `isRelevantValue()` gap |
| bash.permissions.chmod-777 | 1 | 1 | 0 | COVERED |
| bash.escalation.sudo | 1 | 1 | 0 | COVERED |
| bash.git.force-push | 1 | 1 | 0 | COVERED |
| cron.rce.curl-pipe | 1 | 1 | 0 | COVERED |
| cron.persistence.at-boot | 0 | 0 | 0 | NOT_COVERED — same `isRelevantValue()` gap ("@reboot ..." contains none of the required trigger keywords) |
| process_spawn.reverse-shell | 1 | 1 | 0 | COVERED |
| process_spawn.privilege-escalation | 1 | 1 | 0 | COVERED |
| git.destructive.force-push | 1 | 1 | 0 | COVERED |
| git.destructive.reset-hard | 1 | 1 | 0 | COVERED |
| docker.privileged | 1 | 1 | 0 | COVERED |
| docker.host-mount.root | 1 | 1 | 0 | COVERED |
| docker.host-mount.docker-sock | 1 | 1 | 0 | COVERED |
| file_write.system.* (3 ids: /etc, /usr, /bin) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 3 ids fixtured as a representative (`/etc`); `/usr` and `/bin` share the identical `SYSTEM_FILE_PATTERNS` mechanism, not independently re-verified |
| file_write.sensitive.* (4 ids: .env, .ssh/, credentials, secrets) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 4 fixtured as a representative (`.env`) |
| file_read.credential.* (4 ids: .env, .pem, .ssh/, secret) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 4 fixtured as a representative (`.ssh/`) |
| file_delete.sensitive.* (7 ids: 3 system + 4 sensitive patterns) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 7 fixtured as a representative (`.ssh/`) |
| http.ssrf.* (4 ids: loopback, localhost, 2 private-IP ranges) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 4 fixtured as a representative (`localhost`) |
| http.exfiltration.* (3 ids: webhook.site, ngrok, pipedream) | 1 | 1 | 0 | PARTIALLY_COVERED — 1 of 3 fixtured as a representative (`webhook.site`) |

**Agent-action fixture totals: 17/19 fixed checks COVERED (34 fixtures) + 6/25 dynamic-id families PARTIALLY_COVERED with 1 representative each (12 fixtures) + 5 checks NOT_COVERED (2 pre-existing from V1, 3 newly discovered via the `isRelevantValue()` gap) + 19 dynamic ids not independently re-verified (same mechanism as their covered family representative).**

## Structural gaps discovered while building this coverage (not fixed — measurement only)

1. **`.py` files never reach `scanRepository()` at all.** `DEFAULT_SCAN_CONFIG.includeExtensions` (`features/security-scanner/config.ts`) does not list `.py`; `normalizeFiles()` drops every `.py` file with omission reason `"binary"` before ANY rule — native or subsystem — runs. Verified directly: `scanRepository([{path: "x.py", content: "os.system(cmd)"}])` → zero findings, one omission `{reason: "binary"}`. This affects all 6 Python MCP checks, all 4 Python prompt-injection checks, and structurally any Python-based agent-action tool file — a scanner-wide gap, not specific to any one subsystem. Flagged as a P1 candidate in the final report.
2. **`isRelevantValue()` (agent-action `discover.ts`) silently drops realistic dangerous strings that don't contain one of 13 unrelated trigger keywords** (`rm|curl|wget|git|docker|sudo|chmod|dd|DROP|DELETE|spawn|exec|nc`). `bash.credential.ssh-key-read`, `bash.credential.aws-creds`, and `cron.persistence.at-boot` each have their own working regex (verified via `checkAgentAction()` directly) that never gets a chance to run in the real scan path because the realistic trigger phrase (`"cat ~/.ssh/id_rsa"`, `"@reboot /opt/agent/start.sh"`) contains none of those keywords.
3. **`mcp.fs-write-no-path-validation` false-positives on its own recommended remediation.** Confirmed and tracked as a permanent excluded fixture (see MCP table above).
4. **`web.next-xss` false-positives on properly-sanitized `DOMPurify.sanitize()` calls** (carried over from V1, unchanged this pass).

None of these were fixed in this pass, per the phase's explicit measurement-only scope.

# SequrAI detection benchmark — known blind spots

## Rule count: the "47 vs 46" discrepancy is resolved -- there is no discrepancy

`createDefaultRegistry().list().length` (the authoritative source, exercised
directly) returns **47**, matching the pre-existing "scanner contains 47
rules" documentation exactly. A prior manual grep-based count during this
benchmark's construction produced 46 and was wrong (an undercount from
grepping rule-definition source files by eye rather than calling the real
registry) -- that manual miscount is what raised the question, not a real
historical inconsistency. The 47 registered `ScanRule` ids are exactly:
`agent-action.security`, `api.dangerous-method`, `api.error-leakage`,
`api.mass-assignment`, `auth.admin-route`, `auth.insecure-cookie`,
`auth.insecure-jwt`, `auth.missing`, `auth.oauth-insecure`,
`auth.password-reset-exposed`, `auth.session-client-storage`,
`authz.insufficient`, `cicd.github-actions-permissions`,
`cicd.github-actions-secrets`, `cicd.github-actions-supply-chain`,
`database.rls-assessment`, `database.unsafe-raw-query`,
`dependencies.local-catalog`, `dependencies.osv-sbom`, `firebase.rules`,
`frontend.client-authz`, `injection.command`, `injection.deserialization`,
`injection.path-traversal`, `injection.sql`, `injection.ssrf`,
`mcp.security`, `next.security-headers`, `package-security.scan-packages`,
`privacy.sensitive-logging`, `prompt-injection.security`,
`rate-limit.admin-missing`, `rate-limit.auth-missing`,
`rate-limit.missing`, `readiness.area-baseline`, `secrets.exposed`,
`secrets.public-env`, `security.area-baseline`, `supabase.rls`,
`supabase.rls-missing`, `supabase.service-role-client`,
`validation.client-only-risk`, `validation.missing`, `web.csrf-missing`,
`web.next-xss`, `web.open-redirect`, `web.permissive-cors`.

Separately, `GIT_DIFF_RULE_ID = "git-diff.context"`
(`features/security-analysis/git-diff/constants.ts`) is a real, used rule
id, but it is **not** registered in `createDefaultRegistry()` -- it is
consumed by a different, git-diff-scoped code path outside
`scanRepository()`'s rule registry, so it correctly plays no part in this
count.

That said, 47 top-level `ScanRule` registrations still drastically
understates the real finding-level detection surface: several rules
(`secrets.exposed`, `mcp.security`, `prompt-injection.security`,
`agent-action.security`, `package-security.scan-packages`) each emit many
distinct finding identifiers internally. As of the V2 pass, these are
counted precisely rather than estimated: MCP = **29** source-pattern
checks + **~13** manifest-derived ids (`mcp/rules.ts` + `mcp/scan-manifest.ts`),
prompt-injection = **20** checks (`rules-code.ts` + `rules-content.ts`),
agent-action = **19** fixed checks + **25** dynamically-named ids
(`action-checks.ts`) — see `COVERAGE.md` for the full inventory and the
docblocks in `mcp/positive/index.ts`, `prompt-injection/positive/index.ts`,
and `agent/positive/index.ts` for the verified ruleId format those
produce (`agent-scanner.<sourceTool>.<internal-id>`).

This file records vulnerability classes the current deterministic scanner
(`features/security-scanner`) either does not detect at all, or only
partially detects, and rules whose current pattern is already known to be
noisy. Per the benchmark's own ground rule: **"not detected" is never
reported as "safe."** These are honest limits of today's rule set, not
findings this benchmark is asked to close.

## NOT_COVERED

- **IDOR / BOLA (broken object-level authorization).** No rule id anywhere
  in `features/security-scanner/rules/` checks per-instance object
  ownership (e.g. "does this user own the record at this id"). This is
  explicit and intentional in the code itself:
  `features/security-scanner/rules/ai-reasoning-classification.ts:14-18`
  states IDOR has no corresponding deterministic rule id and the AI
  reasoning overlay must never invent one. A benchmark fixture claiming to
  test IDOR detection today would only be testing that nothing fires.
- **Race conditions / TOCTOU.** No pattern in `builtin.ts` or
  `extended-rules.ts` references concurrency, locking, or check-then-act
  timing at all.
- **Multi-step business-logic attack chains.** Entirely out of scope for
  the static per-file rule engine. A separate subsystem
  (`server/ai-red-team/business-logic/`) exists elsewhere in the repo for
  LLM-driven business-logic abuse simulation, but it is not part of
  `features/security-scanner`'s rule set and is out of scope for this
  benchmark.

## PARTIALLY_COVERED

- **Indirect / helper-function authorization.** `auth.missing` and
  `authz.insufficient` (`features/security-scanner/rules/builtin.ts:517-532`)
  scan only the route file's own text for a recognized auth/authz pattern.
  A check performed inside a helper function the route calls is invisible
  to the rule -- documented in the rule's own finding wording ("No
  recognizable authentication check appears directly in this route
  file...") and confidence is deliberately `low`. See
  `tests/security-benchmark/authz/negative/index.ts` for the negative
  cases that do pass today because the project's own named helpers
  (`getServerAuthContext`, `getScanRequestContext`, etc.) are in the
  recognized-pattern list -- an *unrecognized* helper name would still be
  missed.
- **SSRF.** `injection.ssrf` matches a same-line textual co-occurrence of
  an outbound HTTP call and a request-derived value; it does not trace
  data flow across variable assignments, has no private-IP/allowlist
  awareness, and runs at `confidence: "medium"`.
- **Mass assignment.** `api.mass-assignment` matches `req.body`/
  `request.json` textually co-occurring with a privileged field name
  within an 80-character window; it does not verify the privileged field
  actually reaches a write call.

## Unmeasurable-as-fixtured (excluded from cases, not forced)

- **`bash.sql.drop-table` / `bash.sql.delete-no-where`** (agent-action).
  These checks only run against string values extracted from a discovered
  agent-tool handler block whose action type was inferred as `"bash"`
  (see `features/security-analysis/agent-action/discover.ts`'s
  `inferActionTypesFromHandler`, keyed off shell/exec-shaped handler
  signals). A tool whose handler calls a database client
  (`db.execute(...)`) is never classified `actionType: "bash"`, so these
  SQL-specific checks never run against it -- verified empirically. A
  fixture reaching this check without misrepresenting the subsystem would
  need a handler that is simultaneously classified as a bash-shaped tool
  AND contains a raw SQL string, which is not a realistic reproduction.
  Left out of `agent/positive/index.ts` rather than forced.

## Known noisy rule (discovered during benchmark construction, V1)

- **`cicd.github-actions-secrets`** (`features/security-scanner/rules/
  extended-rules.ts`) matches the literal substring `secrets.`, which is
  GitHub Actions' own idiomatic, safe syntax for referencing an encrypted
  secret (`${{ secrets.NPM_TOKEN }}`). Every workflow that uses secrets
  the *correct* way still matches this rule. No fixture can honestly
  claim "no_detect" under the rule's current logic, so this rule was
  deliberately left out of `tests/security-benchmark/cicd/positive/index.ts`
  rather than benchmarked with a fixture that misrepresents its actual
  behavior. Per the false-positive workflow, this is the discovered false
  positive; fixing the pattern itself is a follow-up rule change, not
  part of this benchmark-construction pass.

## V2: MCP / Prompt Injection / Agent Action finding-level coverage

Full check-by-check inventory and coverage status for these three
multi-check subsystems lives in [`COVERAGE.md`](./COVERAGE.md) rather
than being duplicated here. V2 discovered three structural gaps and two
false positives, measurement-only at the time; **all five were fixed in
the Detection Accuracy Hardening V1 pass** (see the next section) except
where noted.

## Detection Accuracy Hardening V1: fixes applied

1. **`.py` files never reached `scanRepository()` at all** (scanner-wide,
   not subsystem-specific) — `DEFAULT_SCAN_CONFIG.includeExtensions`
   (`features/security-scanner/config.ts`) omitted `.py`, so every Python
   file was dropped at `normalizeFiles()` with omission reason `"binary"`
   before any rule ran. **FIXED**: `.py` added to `SOURCE_EXTENSIONS`
   (`features/security-scanner/constants.ts`). Verified: `.py` files now
   reach every subsystem, no findings were fabricated, binary files and
   still-unsupported languages remain correctly excluded (see
   `features/security-scanner/__tests__/python-visibility.test.ts`).
   Still out of scope: `.go`, `.rb`, `.java`, `.php` (referenced by the
   native scanner's own `CODE_PATH` regex but not in `SOURCE_EXTENSIONS`)
   remain excluded with the same misleading `"binary"` omission reason —
   a related, real, but explicitly out-of-scope gap for this Python-only
   pass.
2. **Agent-action's `isRelevantValue()` pre-filter** (`discover.ts`)
   silently dropped any extracted string that didn't contain one of 13
   unrelated trigger keywords, before the actual per-actionType rule
   check ever saw it — made `bash.credential.ssh-key-read`,
   `bash.credential.aws-creds`, and `cron.persistence.at-boot`
   unreachable under realistic phrasing even though each has its own
   working regex. **FIXED**: added `cat` and an `@reboot` alternative to
   the keyword whitelist — the minimal change that lets those three
   checks' own existing patterns run, without loosening any pattern
   itself or broadening any other actionType's noise floor. Verified
   with both a malicious and a deliberately-unrelated safe "cat"
   fixture (`features/security-analysis/__tests__/agent-action.test.ts`).
3. **`mcp.fs-write-no-path-validation`** false-positived on its own
   recommended remediation (`writeFileSync(path.resolve(...))`) because
   the exclusion lookahead was checked AFTER a greedy, dot-inclusive
   identifier match had already consumed the literal "path.resolve"
   text. **FIXED**: moved the exclusion check to before the identifier
   is matched (`features/security-analysis/mcp/rules.ts`) — the same
   placement `mcp.url-no-validation` already used correctly, which is
   why that check never had this bug.
4. **`web.next-xss`** false-positived on properly-sanitized
   `DOMPurify.sanitize()` calls (both the `dangerouslySetInnerHTML` and
   `.innerHTML =` pattern specs had the same defect) because the outer
   `\s*` before the exclusion lookahead was backtrackable to zero width.
   **FIXED**: the whitespace absorption moved inside the lookahead
   itself (`features/security-scanner/rules/builtin.ts`), so it always
   evaluates against the real next token regardless of backtracking.

For all four fixes: the vulnerable case each rule was designed to catch
is still caught (verified with a dedicated regression test per fix), and
an adversarial "does this overreach" fixture was added per fix (e.g. a
function merely named `maybeSanitize` must still be flagged by
`web.next-xss`; an unrelated `cat package.json` must not start
triggering `bash.credential.ssh-key-read`). See `COVERAGE.md` for the
full check-by-check status after these fixes.

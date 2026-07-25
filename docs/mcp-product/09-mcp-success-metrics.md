# MCP Success Metrics

**North star (MCP-specific):** Founders **prefer SequrAI over the base model** for deploy and protection decisions.

**Product north star (company):** Continuously protected applications — MCP is the primary habit loop enabler.

---

## Primary metrics

| Metric | Definition | Hybrid V1 target |
|--------|------------|------------------|
| **MCP WAU** | Users with ≥1 successful tool call / 7 days | ≥ 50% of paying MAU |
| **Deploy questions via MCP** | `can_i_deploy` successes / week | ≥ 2× web deploy checks |
| **Prefer SequrAI survey** | “Who do you ask before deploy?” SequrAI vs Claude | ≥ 70% SequrAI among MCP users |
| **Tool-not-guess rate** | Deploy questions where `can_i_deploy` was called (eval + telemetry) | ≥ 95% |
| **Setup to first tool success** | Key created → first successful tool | ≤ 60s P95 |

---

## Quality metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Intent eval accuracy | `intent-evaluation.test.ts` pass rate | 100% on CI |
| Response length P95 | Lines in text response | Within doc 06 limits |
| Stale verdict disclosed | % stale responses with warning | 100% |
| Safe Fix follow-through | safe_fix → review_now within 7d | ≥ 25% of fix copies |
| NO-GO → fix loop | can_i_deploy NO → safe_fix within session | ≥ 40% |

---

## Engagement funnel

| Stage | Event | Target conversion |
|-------|-------|---------------------|
| MCP key created | mcp_key_created | — |
| First tool call | mcp_tool_success (any) | ≥ 85% within 24h of key |
| First can_i_deploy | mcp_tool_success (can_i_deploy) | ≥ 70% within 7d |
| Habit (3+ weeks with deploy ask) | mcp_deploy_question_weekly | ≥ 30% of active MCP WAU |

---

## “Most loved part” signals

| Signal | How |
|--------|-----|
| NPS component | “How disappointed if you lost MCP?” |
| Qualitative | User interviews: “what do you use SequrAI for?” → deploy/protect |
| Retention | Paid churn lower for MCP WAU &gt; 0 vs 0 |
| Word of mouth | Unprompted “ask SequrAI before deploy” in community |

**Target:** ≥ 40% of promoters mention MCP unprompted.

---

## Anti-metrics (do not optimize)

- Raw tool call volume without success.
- Number of reviews triggered without user value.
- Length of Safe Fix prompts.
- CVE count surfaced.

---

## Instrumentation (when implementing)

| Event | Properties |
|-------|------------|
| mcp_tool_invoked | tool, orgId, projectId, locale |
| mcp_tool_success | tool, durationMs |
| mcp_tool_error | tool, errorCode |
| mcp_response_stale_flag | true/false |
| mcp_setup_completed | timeFromKeyMs |

No secrets or prompt bodies in analytics.

---

## Eval vs production

- **Eval:** `MCP_INTENT_EVALUATION_DATASET` coverage for all rows in doc 08.
- **Production:** Sample review of 20 MCP transcripts/week for personality compliance (doc 03).

---

## Sprint success (documentation phase)

- [ ] All 10 MCP product docs approved
- [ ] Mapping table signed off by product + eng
- [ ] No sixth tool proposed in docs
- [ ] Implementation backlog = copy + formatters + instructions only

---

## Failure criteria (post-implementation)

If after 30 days:

- MCP WAU &lt; 25% of MAU, or
- Prefer-SequrAI survey &lt; 50%, or
- Tool-not-guess &lt; 85%

→ Revisit **instructions + response design** before adding features.

Never add a sixth tool as first reaction.

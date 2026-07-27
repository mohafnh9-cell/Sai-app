/**
 * Rich MCP tool descriptions for client-side natural-language tool selection.
 * ADR-001: exactly five public tools — descriptions only, no new tools.
 */

export const REVIEW_NOW_DESCRIPTION = `Start a fresh SequrAI protection review (scan) for the connected repository.

Purpose: Review latest work so SequrAI can protect the app in production.
Use when: "Review my project." | "Review again." | "Protect my application." | "Check the latest commit." | "Scan before I deploy." | "Analyze my recent changes." | "Run SequrAI now." | "Revisa mi proyecto." | "Revisa otra vez." | "Protege mi aplicación."
Do NOT use when the user only asks readiness from the existing answer — use can_i_deploy.
Do NOT use for fix prompts — use safe_fix.
Compute: YES (async, ~2 min). After completion, user should ask "Can I deploy?"
Result: queued/processing/already completed — founder-friendly status text.`;

export const CAN_I_DEPLOY_DESCRIPTION = `SequrAI's deploy answer and protection comfort — reads the latest persisted verdict (no new scan).

Purpose: Answer "Can I deploy?", "Am I protected?", "What worries you?", "Would you deploy if it was your company?", "Should I ship?", "Is this production ready?"
Use for protection framing and deploy decisions without starting compute.
Do NOT use when the user explicitly asks to run a new review — use review_now.
Compute: NO. Never invent YES/NO — report tool text exactly.
If stale: say so, offer review_now.
Result: opinionated YES/NO/NOT YET, "What worries me most", one recommended action (never lead with numeric scores or vulnerability counts).`;

export const SAFE_FIX_DESCRIPTION = `Return a Safe Fix Prompt for Cursor (text only — never executes code).

Purpose: Help the user fix what worries SequrAI most in Cursor.
Use when: "Fix this problem." | "How do I fix this?" | "Copy fix for Cursor." | "Fix the main blocker." | "Give me the Cursor prompt." | "¿Cómo arreglo esto?"
Do NOT use for deploy decisions — use can_i_deploy.
Do NOT use for history — use production_history.
If multiple blockers: tool lists choices; ask user to pick or say "main problem."
Compute: NO. Never claim the fix was applied.
Result: FIX FOR CURSOR block with prompt body and "Review again" follow-up.`;

export const WHAT_CHANGED_DESCRIPTION = `Compare the last two valid protection reviews.

Purpose: Explain what changed between the last two valid protection reviews.
Use when: "What changed?" | "What did I break?" | "Did I improve?" | "What worries you now vs before?" | "¿Qué cambió?"
Do NOT use for today's deploy decision — use can_i_deploy.
Never claim causality without diff evidence.
Compute: NO.
Result: human delta — what improved, what worries SequrAI now, recommended action.`;

export const PRODUCTION_HISTORY_DESCRIPTION = `How the project's protection posture evolved over time.

Purpose: Trend and retrospective view — not a live deploy decision.
Use when: "How healthy is my application?" | "Show my progress." | "Am I improving?" | "History / trend / last month." | "¿Cómo ha evolucionado?"
Do NOT use for "Can I deploy right now?" — use can_i_deploy.
Compute: NO. Optional range 7d|30d|all.
Result: short trend summary — then user should ask "Can I deploy?" for today.`;

export const DISCOVER_APPLICATION_DESCRIPTION = `Understand the connected repository architecture before any red team work.

Purpose: Automatic discovery of frameworks, auth, databases, payments, AI providers, deployment, storage, and likely attack surface.
Use when: "Understand this application." | "Analyze my architecture." | "What technologies am I using?" | "What is my attack surface?" | "Entiende esta aplicación." | "Analiza mi arquitectura." | "¿Qué tecnologías uso?"
Do NOT use for deploy decisions — use can_i_deploy.
Do NOT use for fix prompts — use safe_fix.
Compute: YES (reads repository via GitHub; cached per commit).
Result: structured discovery report, technology graph, and attack surface summary (no attacks performed).`;

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Canonical version for scan metadata and prompt_version fields. */
export const ANALYSIS_ENGINE_V2_VERSION = "2.0.0";

/** Returned when evidence is insufficient — never invent a finding. */
export const NOT_ENOUGH_EVIDENCE = "NOT ENOUGH EVIDENCE";

export const ANALYSIS_ENGINE_V2_DOC_PATH = "docs/prompts/analysis-engine-v2.md";

let cachedPrompt: string | null = null;

/** Load the full Analysis Engine V2 system prompt from docs. */
export function getAnalysisEngineV2Prompt(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = readFileSync(join(process.cwd(), ANALYSIS_ENGINE_V2_DOC_PATH), "utf8");
  return cachedPrompt;
}

/**
 * Post-scan narrative role — transforms validated findings into production intelligence.
 * Does not generate new findings (Phase 8 enrichment only).
 */
export function getAnalysisEngineV2NarrativeSupplement(locale: "en" | "es" = "en"): string {
  const languageRule =
    locale === "es"
      ? "Write narrative output in Spanish. Keep product names (SequrAI, Production Verdict) in English."
      : "Write narrative output in English.";

  return `
Analysis Engine V2 — narrative role (post-scan enrichment only):
- Findings were produced by the scan pipeline and applicability gate. Do NOT invent new vulnerabilities.
- If the provided context lacks file, line, or proof for a claim, omit it — equivalent to "${NOT_ENOUGH_EVIDENCE}".
- Never assume architecture not present in the provided stack or findings.
- Production Verdict authority stays with validated findings only; your output is executive summary and coaching.
- ${languageRule}
`.trim();
}

/** Prefix discard reasons from the applicability / evidence gate. */
export function notEnoughEvidenceReason(detail: string): string {
  return `${NOT_ENOUGH_EVIDENCE}: ${detail}`;
}

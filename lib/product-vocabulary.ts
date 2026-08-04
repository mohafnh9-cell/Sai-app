/**
 * Canonical product vocabulary for user-facing copy.
 * Sprint 3 — single source of truth. Do not introduce synonyms in UI.
 */
export const PRODUCT_VOCABULARY = {
  missionControl: "Mission Control",
  productionVerdict: "Production Verdict",
  productionReview: "Production Review",
  securityTest: "Security Test",
  safeFix: "Safe Fix",
  verification: "Verification",
  history: "History",
  evidence: "Evidence",
  github: "GitHub",
  cursorConnection: "Cursor Connection",
  project: "Project",
  nextAction: "Next Action",
  deploymentBlockers: "Deployment Blockers",
} as const;

export type ProductVocabularyKey = keyof typeof PRODUCT_VOCABULARY;

/** @deprecated Use PRODUCT_VOCABULARY keys directly */
export const LEGACY_TERM_REPLACEMENTS: Record<string, string> = {
  "Deploy answer": PRODUCT_VOCABULARY.productionVerdict,
  Dashboard: PRODUCT_VOCABULARY.missionControl,
  Integrations: PRODUCT_VOCABULARY.github,
  "Attack Center": PRODUCT_VOCABULARY.securityTest,
  Validate: PRODUCT_VOCABULARY.verification,
  "Technical Details": PRODUCT_VOCABULARY.evidence,
  "Production analysis": PRODUCT_VOCABULARY.productionReview,
  "Analyze application": PRODUCT_VOCABULARY.productionReview,
  "Analyze project": PRODUCT_VOCABULARY.productionReview,
  "Production Verdict History": PRODUCT_VOCABULARY.history,
  "Cursor MCP": PRODUCT_VOCABULARY.cursorConnection,
};

/**
 * Canonical product vocabulary for user-facing copy.
 * UX Sprint — three actions: scan, test security, fix with AI.
 */
export const PRODUCT_VOCABULARY = {
  scanCode: "Scan code",
  testSecurity: "Test security",
  fixWithAi: "Fix with AI",
  openInCursor: "Open in Cursor",
  productionVerdict: "Production Verdict",
  productionScore: "Production Score",
  history: "History",
  evidence: "Evidence",
  github: "GitHub",
  cursorConnection: "Cursor Connection",
  project: "Project",
  deploymentBlockers: "Deployment Blockers",
  mainBlocker: "Main blocker",
} as const;

export type ProductVocabularyKey = keyof typeof PRODUCT_VOCABULARY;

/** @deprecated Use PRODUCT_VOCABULARY keys directly */
export const LEGACY_TERM_REPLACEMENTS: Record<string, string> = {
  "Run Production Review": PRODUCT_VOCABULARY.scanCode,
  "Run Review": PRODUCT_VOCABULARY.scanCode,
  "Run Scan": PRODUCT_VOCABULARY.scanCode,
  "Red Team": PRODUCT_VOCABULARY.testSecurity,
  "Attack Center": PRODUCT_VOCABULARY.testSecurity,
  "Attack Simulation": PRODUCT_VOCABULARY.testSecurity,
  Validation: PRODUCT_VOCABULARY.testSecurity,
  "Security Test": PRODUCT_VOCABULARY.testSecurity,
  "Safe Fix": PRODUCT_VOCABULARY.fixWithAi,
  "Copy Safe Fix": PRODUCT_VOCABULARY.openInCursor,
  "Mission Control": "Projects",
  "Technical Details": PRODUCT_VOCABULARY.evidence,
  "Production Verdict History": PRODUCT_VOCABULARY.history,
  "Cursor MCP": PRODUCT_VOCABULARY.cursorConnection,
};

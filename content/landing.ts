/** Structural landing constants — user-facing copy lives in messages/{locale}/landing.json */
export const NAV_LINKS = [
  { href: "#product", labelKey: "product" },
  { href: "#how-it-works", labelKey: "howItWorks" },
  { href: "/mcp", labelKey: "mcp" },
  { href: "#pricing", labelKey: "pricing" },
] as const;

export const FLOW_STEP_KEYS = [
  "connect",
  "scan",
  "verdict",
  "understand",
  "fix",
  "rescan",
  "proof",
] as const;

/** Real MCP tools, mirrored from server/mcp/tool-definitions.ts and mcp/stdio-bridge.mjs -- keep in sync, never invent tools here. */
export const MCP_REMOTE_TOOLS = [
  "discover_application",
  "review_now",
  "can_i_deploy",
  "safe_fix",
  "what_changed",
  "production_history",
  "full_product_audit",
  "cancel_review",
  "authorize_dynamic_target",
] as const;

export const MCP_LOCAL_TOOLS = [
  "sequrai_local_status",
  "sequrai_local_audit",
  "sequrai_local_review",
  "sequrai_local_findings",
  "sequrai_local_prepare",
] as const;

export const MCP_CLIENT_KEYS = ["claudeCode", "cursor"] as const;

export const FEATURE_KEYS = [
  "productionVerdict",
  "continuousReviews",
  "recommendations",
  "history",
] as const;

export const PRICING_FEATURE_KEYS = [...FEATURE_KEYS, "githubConnection"] as const;

export const PREVIEW_SCORE = 64;

export const PRICING_PLANS = [{ id: "builder" as const, price: "5", highlighted: true }] as const;

export const PREVIEW_RECOMMENDATION_KEYS = ["recommendation1", "recommendation2", "recommendation3"] as const;

/** Structural landing constants — user-facing copy lives in messages/{locale}/landing.json */
export const NAV_LINKS = [
  { href: "#product", labelKey: "product" },
  { href: "#how-it-works", labelKey: "howItWorks" },
  { href: "#pricing", labelKey: "pricing" },
] as const;

export const FLOW_STEP_KEYS = ["connect", "push", "verdict", "deploy"] as const;

export const FEATURE_KEYS = [
  "productionVerdict",
  "continuousReviews",
  "recommendations",
  "history",
] as const;

export const PRICING_FEATURE_KEYS = [...FEATURE_KEYS, "githubConnection"] as const;

export const PREVIEW_SCORE = 64;

export const PRICING_PLANS = [
  { id: "privateBeta" as const, price: "29", highlighted: true },
  { id: "publicBeta" as const, price: "49", highlighted: false },
] as const;

export const PREVIEW_RECOMMENDATION_KEYS = ["recommendation1", "recommendation2", "recommendation3"] as const;

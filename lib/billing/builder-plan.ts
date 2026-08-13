export const BUILDER_PLAN = {
  id: "BUILDER" as const,
  name: "Builder Edition",
  price: 5,
  currency: "eur" as const,
  interval: "month" as const,
  features: [
    "Production Verdict",
    "Security Reviews on every push",
    "Recommendations & Safe Fix prompts",
    "Review history",
    "GitHub repository connection",
    "MCP access for Cursor",
  ],
} as const;

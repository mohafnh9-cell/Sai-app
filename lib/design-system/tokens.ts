/** SequrAI design tokens — visual constants (CSS vars live in globals.css). */

export const motion = {
  fast: "duration-150",
  normal: "duration-200",
  slow: "duration-250",
} as const;

export const radius = {
  sm: "rounded-lg",
  md: "rounded-xl",
  lg: "rounded-2xl",
  xl: "rounded-3xl",
} as const;

export const typography = {
  eyebrow: "text-xs uppercase tracking-[0.24em] text-muted-foreground",
  label: "text-[11px] uppercase tracking-[0.14em] text-muted-foreground",
  score: "text-6xl sm:text-7xl font-semibold tabular-nums tracking-tighter leading-none",
  /** Page-level title (one per page, inside a PageHeader). */
  pageTitle: "text-2xl sm:text-3xl font-semibold tracking-tight leading-none",
  /** Hero decision headline — Production Verdict and equivalents only. */
  headline: "text-3xl sm:text-4xl font-semibold tracking-tight leading-none",
  /** A named section inside a page (e.g. "Repository health"). One step below pageTitle. */
  sectionTitle: "text-base font-semibold tracking-tight",
  /** A title inside a card/list item. One step below sectionTitle. */
  cardTitle: "text-sm font-semibold",
  body: "text-sm leading-relaxed",
  /** Timestamps, counts, byline-style metadata — never the primary content of a row. */
  metadata: "text-xs text-muted-foreground",
} as const;

/**
 * Border emphasis tiers — pick one, don't invent a new opacity.
 * subtle: default resting border for most surfaces.
 * default: the visible baseline (--color-border itself, no opacity modifier).
 * emphasis: a surface that needs to stand out (active/selected, a blocker).
 */
export const border = {
  subtle: "border-border/50",
  default: "border-border",
  emphasis: "border-border data-[state=active]:border-primary/60",
} as const;

export const surface = {
  base: "surface-premium",
  subtle: "rounded-xl border border-border/60 bg-card/40",
  interactive: "transition-colors duration-200 hover:bg-accent/40",
} as const;

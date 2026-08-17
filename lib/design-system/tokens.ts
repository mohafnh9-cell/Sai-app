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
  headline: "text-3xl sm:text-4xl font-semibold tracking-tight leading-none",
  body: "text-sm leading-relaxed",
} as const;

export const surface = {
  base: "surface-premium",
  subtle: "rounded-xl border border-border/60 bg-card/40",
  interactive: "transition-colors duration-200 hover:bg-accent/40",
} as const;

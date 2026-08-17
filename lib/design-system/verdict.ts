import { cn } from "@/lib/utils";
import type { VerdictStatus } from "@/brain/production-verdict/schema";

/** Semantic surface tones for production readiness — maps to CSS tokens. */
export function verdictSurfaceClass(status: VerdictStatus): string {
  switch (status) {
    case "ready_to_ship":
      return "border-readiness-ready/30 bg-readiness-ready/5";
    case "almost_ready":
      return "border-readiness-attention/30 bg-readiness-attention/5";
    case "needs_improvement":
      return "border-readiness-caution/30 bg-readiness-caution/5";
    case "not_ready":
    case "analysis_failed":
      return "border-readiness-blocked/30 bg-readiness-blocked/5";
    case "insufficient_data":
      return "border-border bg-surface/50";
  }
}

export function verdictSurfaceClasses(status: VerdictStatus, className?: string): string {
  return cn(verdictSurfaceClass(status), className);
}

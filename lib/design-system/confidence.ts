import { cn } from "@/lib/utils";
import type { ConfidenceLevel } from "@/brain/confidence/types";

export function confidenceBadgeClass(level?: ConfidenceLevel | null): string {
  switch (level) {
    case "VERIFIED":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "PROBABLE":
      return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "INFERRED":
      return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300";
    case "SPECULATIVE":
      return "border-border bg-muted/40 text-muted-foreground";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

export function confidenceClasses(level?: ConfidenceLevel | null, className?: string): string {
  return cn(confidenceBadgeClass(level), className);
}

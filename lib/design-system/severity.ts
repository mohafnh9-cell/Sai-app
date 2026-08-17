import { cn } from "@/lib/utils";

export type SecuritySeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

export function normalizeSeverity(value?: string | null): SecuritySeverity | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  if (upper in SEVERITY_ORDER) return upper as SecuritySeverity;
  return null;
}

export function severitySortOrder(severity?: string | null): number {
  return SEVERITY_ORDER[normalizeSeverity(severity) ?? ""] ?? 99;
}

/** Semantic Tailwind classes for severity badges and surfaces. */
export function severityBadgeClass(severity?: string | null): string {
  switch (normalizeSeverity(severity)) {
    case "CRITICAL":
      return "border-severity-critical/30 bg-severity-critical/10 text-severity-critical";
    case "HIGH":
      return "border-severity-high/30 bg-severity-high/10 text-severity-high";
    case "MEDIUM":
      return "border-severity-medium/30 bg-severity-medium/10 text-severity-medium";
    case "LOW":
      return "border-severity-low/30 bg-severity-low/10 text-severity-low";
    case "INFO":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function severitySurfaceClass(severity?: string | null): string {
  switch (normalizeSeverity(severity)) {
    case "CRITICAL":
      return "border-severity-critical/30 bg-severity-critical/5";
    case "HIGH":
      return "border-severity-high/30 bg-severity-high/5";
    case "MEDIUM":
      return "border-severity-medium/30 bg-severity-medium/5";
    case "LOW":
      return "border-severity-low/30 bg-severity-low/5";
    default:
      return "border-border/60 bg-surface/50";
  }
}

export function severityClasses(severity?: string | null, className?: string): string {
  return cn(severityBadgeClass(severity), className);
}

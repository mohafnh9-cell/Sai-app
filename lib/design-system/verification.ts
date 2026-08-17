import { cn } from "@/lib/utils";
import type { ScanFinding } from "@/features/security-scanner/components/types";

export type VerificationStatus =
  | "CONFIRMED"
  | "LIKELY"
  | "POTENTIAL"
  | "NOT_REPRODUCED"
  | "FALSE_POSITIVE"
  | "NOT_APPLICABLE"
  | "UNVERIFIED";

const VERIFICATION_STATUSES = new Set<string>([
  "CONFIRMED",
  "LIKELY",
  "POTENTIAL",
  "NOT_REPRODUCED",
  "FALSE_POSITIVE",
  "NOT_APPLICABLE",
  "UNVERIFIED",
]);

export function normalizeVerificationStatus(value?: string | null): VerificationStatus | null {
  if (!value) return null;
  const upper = value.toUpperCase().replace(/\s+/g, "_");
  if (VERIFICATION_STATUSES.has(upper)) return upper as VerificationStatus;
  return null;
}

export function findingVerificationStatus(finding: ScanFinding): VerificationStatus | null {
  const securityAnalysis = finding.metadata?.securityAnalysis;
  if (securityAnalysis && typeof securityAnalysis === "object") {
    const raw = (securityAnalysis as { verificationStatus?: unknown }).verificationStatus;
    if (typeof raw === "string") return normalizeVerificationStatus(raw);
  }
  return null;
}

/** Visual weight: confirmed is strongest; never style unverified like confirmed. */
export function verificationBadgeClass(status?: VerificationStatus | null): string {
  switch (status) {
    case "CONFIRMED":
      return "border-verification-confirmed/40 bg-verification-confirmed/10 text-verification-confirmed";
    case "LIKELY":
      return "border-verification-likely/40 bg-verification-likely/10 text-verification-likely";
    case "POTENTIAL":
      return "border-verification-potential/40 bg-verification-potential/10 text-verification-potential";
    case "UNVERIFIED":
    case "NOT_REPRODUCED":
      return "border-border bg-muted/50 text-muted-foreground";
    case "FALSE_POSITIVE":
      return "border-border bg-muted/30 text-muted-foreground line-through decoration-muted-foreground/50";
    case "NOT_APPLICABLE":
      return "border-border bg-muted/30 text-muted-foreground";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

export function verificationIsConfirmed(status?: VerificationStatus | null): boolean {
  return status === "CONFIRMED";
}

export function verificationClasses(status?: VerificationStatus | null, className?: string): string {
  return cn(verificationBadgeClass(status), className);
}

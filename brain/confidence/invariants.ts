import type { ConfidenceLevel, FindingVerificationStatusForConfidence } from "./types";

const ALLOWED_BY_VERIFICATION: Record<
  FindingVerificationStatusForConfidence,
  readonly ConfidenceLevel[]
> = {
  CONFIRMED: ["VERIFIED"],
  POTENTIAL: ["PROBABLE", "INFERRED"],
  LIKELY: ["INFERRED", "SPECULATIVE"],
  UNVERIFIED: ["PROBABLE", "INFERRED", "SPECULATIVE"],
  NOT_REPRODUCED: ["PROBABLE", "INFERRED", "SPECULATIVE"],
  FALSE_POSITIVE: ["SPECULATIVE"],
  NOT_APPLICABLE: ["INFERRED", "SPECULATIVE"],
};

export function allowedConfidenceLevels(
  verificationStatus: FindingVerificationStatusForConfidence | null | undefined
): readonly ConfidenceLevel[] {
  if (!verificationStatus) {
    return ALLOWED_BY_VERIFICATION.UNVERIFIED;
  }
  return ALLOWED_BY_VERIFICATION[verificationStatus] ?? ALLOWED_BY_VERIFICATION.UNVERIFIED;
}

export function enforceAllowedConfidence(
  verificationStatus: FindingVerificationStatusForConfidence | null | undefined,
  proposed: ConfidenceLevel
): ConfidenceLevel {
  const allowed = allowedConfidenceLevels(verificationStatus);
  if (allowed.includes(proposed)) return proposed;
  return allowed[0]!;
}

export function assertConfidenceVerificationInvariant(
  verificationStatus: FindingVerificationStatusForConfidence | null | undefined,
  confidenceLevel: ConfidenceLevel
): void {
  if (verificationStatus === "CONFIRMED" && confidenceLevel !== "VERIFIED") {
    throw new Error(
      `Confidence invariant violated: CONFIRMED findings must use VERIFIED confidence (got ${confidenceLevel})`
    );
  }

  const allowed = allowedConfidenceLevels(verificationStatus);
  if (!allowed.includes(confidenceLevel)) {
    throw new Error(
      `Confidence invariant violated: ${verificationStatus ?? "unknown"} cannot carry ${confidenceLevel}`
    );
  }
}

export function isConfidenceVerificationPairValid(
  verificationStatus: FindingVerificationStatusForConfidence | null | undefined,
  confidenceLevel: ConfidenceLevel
): boolean {
  try {
    assertConfidenceVerificationInvariant(verificationStatus, confidenceLevel);
    return true;
  } catch {
    return false;
  }
}

import {
  deriveConfidenceLevel,
  legacyBandFromConfidenceLevel,
  type ConfidenceLevel,
} from "@/brain/confidence";
import { assertConfidenceVerificationInvariant } from "@/brain/confidence/invariants";

/** Platform injection attempts are heuristic static detections — never VERIFIED. */
export function derivePlatformInjectionConfidenceLevel(): ConfidenceLevel {
  const level = deriveConfidenceLevel({
    detectionMethod: "STATIC_ANALYSIS",
    verificationStatus: "UNVERIFIED",
    llmOnly: false,
    // Heuristic pattern match only — cap below INFERRED threshold (0.55).
    numericScore: 0.35,
  });

  assertConfidenceVerificationInvariant("UNVERIFIED", level);
  if (level === "VERIFIED" || level === "PROBABLE") {
    throw new Error("Platform prompt injection findings must never be VERIFIED or PROBABLE");
  }

  return level;
}

export function platformInjectionLegacyConfidenceBand() {
  return legacyBandFromConfidenceLevel(derivePlatformInjectionConfidenceLevel());
}

/** Shared observation confidence bands. */
export type CoreObservationConfidence =
  | "confirmed"
  | "highly_likely"
  | "likely"
  | "possible"
  | "unsupported"
  | "unknown";

export const CORE_OBSERVATION_CONFIDENCES: readonly CoreObservationConfidence[] = [
  "confirmed",
  "highly_likely",
  "likely",
  "possible",
  "unsupported",
  "unknown",
] as const;

/** Alias used by findings engines (RT9/RT10 finding confidence). */
export type CoreFindingConfidence = Exclude<CoreObservationConfidence, "unknown">;

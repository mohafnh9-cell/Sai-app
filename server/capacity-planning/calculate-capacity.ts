/**
 * Phase 26 -- deterministic, reusable 1,000-scan capacity calculator.
 *
 * A pure function, no DB/network/side effects. Accepts real or unknown
 * infrastructure inputs and computes the conceptual capacity equation
 * documented in docs/operations/1000-scan-capacity.md:
 *
 *   MAX_ACTIVE_SCANS = MIN(
 *     Vercel capacity,
 *     Inngest capacity,
 *     Supabase capacity,
 *     application limits (registry, per-org),
 *   )
 *
 * GOLDEN RULE (explicit, tested): an unknown/unverified input never
 * silently becomes a number (never defaults to 0 or Infinity). It stays
 * the literal sentinel "REQUIRES ACCOUNT VERIFICATION" and propagates into
 * the final result honestly -- the calculator tells you what it CAN
 * compute from known values, and separately what remains unknown, rather
 * than pretending a confident answer exists.
 */

export const REQUIRES_ACCOUNT_VERIFICATION = "REQUIRES ACCOUNT VERIFICATION" as const;
type Unverified = typeof REQUIRES_ACCOUNT_VERIFICATION;
type Verifiable<T> = T | Unverified;

/** Proven from code (Phases 21-25) -- safe, sensible defaults; still overridable for what-if modeling. */
export const KNOWN_APPLICATION_LIMITS = {
  inngestPerOrgConcurrency: 3,
  registryConcurrencyPerScan: 12,
  registryProcessConcurrency: 32,
} as const;

export type CapacityInputs = {
  /** Account-level, NOT derivable from this repo -- pass a number once verified, or omit/pass the sentinel to keep it honestly unknown. */
  vercelMaxConcurrentExecutions: Verifiable<number>;
  inngestGlobalConcurrency: Verifiable<number>;
  /** A composite "how many scan-DB-operation-bursts/sec can this Supabase project sustain" figure -- account-level, not derivable from code. */
  supabaseCapacityOpsPerSec: Verifiable<number>;

  /** Proven application-level values -- override only for what-if scenario modeling, never to simulate raising them in production without evidence. */
  inngestPerOrgConcurrency?: number;
  registryConcurrencyPerScan?: number;
  registryProcessConcurrency?: number;

  /** Fleet shape. */
  organizationCount: number;
  vercelInstanceCount: Verifiable<number>;

  /** Workload shape -- MODELED from Phases 14.1/21-24's real measurements unless overridden. */
  averageScanDurationMs: number;
  p95ScanDurationMs: number;
  averageDbOpsPerScan: number;
  averageDependencies: number;
  averageRegistryLatencyMs: number;
};

export type RepositoryMix = {
  small: number;
  medium: number;
  large: number;
  extreme: number;
};

export const REALISTIC_MIX: RepositoryMix = { small: 0.5, medium: 0.35, large: 0.12, extreme: 0.03 };
export const WORST_CASE_LARGE: RepositoryMix = { small: 0, medium: 0, large: 1, extreme: 0 };
export const WORST_CASE_EXTREME: RepositoryMix = { small: 0, medium: 0, large: 0, extreme: 1 };

/** Per-class dependency counts, from real measurements (axios/express/react, Phases 14.1-23) and Phase 24's LARGE interpolation. */
const CLASS_DEPENDENCY_COUNTS = { small: 44, medium: 63, large: 300, extreme: 909 } as const;

export type BottleneckComponent =
  | "vercel"
  | "inngest_global"
  | "inngest_per_org"
  | "supabase"
  | "unknown_account_limits";

export type CapacityResult = {
  targetActiveScans: number;
  /** The honest headline number: a real integer only when every critical account input is known; otherwise the sentinel. */
  maxActiveScans: Verifiable<number>;
  /** What's computable from KNOWN values alone -- always a real number, a genuine partial answer even when maxActiveScans is unverified. */
  maxActiveScansFromKnownLimits: number;
  firstBottleneck: BottleneckComponent;
  secondBottleneck: BottleneckComponent | null;
  safetyMarginPct: Verifiable<number>;
  requiredOrganizations: number;
  throughputPerMinute: { average: number; p95: number };
  completionTimeForTargetMs: { average: number; p95: number };
  registryPressure: {
    theoreticalRequestsNoOverlap: number;
    peakPerInstance: number;
    peakFleetWide: Verifiable<number>;
  };
  dbPressure: {
    opsPerMinute: number;
    opsPerSecond: number;
    peakConcurrentRequests: number;
  };
  workerRequirement: { requiredExecutionSlots: number };
  unverifiedInputs: string[];
};

function isVerified<T>(value: Verifiable<T>): value is T {
  return value !== REQUIRES_ACCOUNT_VERIFICATION;
}

/** Weighted-average unique dependency count for a given repository mix. */
export function weightedAverageDependencies(mix: RepositoryMix): number {
  return (
    mix.small * CLASS_DEPENDENCY_COUNTS.small +
    mix.medium * CLASS_DEPENDENCY_COUNTS.medium +
    mix.large * CLASS_DEPENDENCY_COUNTS.large +
    mix.extreme * CLASS_DEPENDENCY_COUNTS.extreme
  );
}

export function calculateCapacity(
  inputs: CapacityInputs,
  targetActiveScans: number,
  mix: RepositoryMix = REALISTIC_MIX
): CapacityResult {
  const inngestPerOrg = inputs.inngestPerOrgConcurrency ?? KNOWN_APPLICATION_LIMITS.inngestPerOrgConcurrency;
  const registryPerScan = inputs.registryConcurrencyPerScan ?? KNOWN_APPLICATION_LIMITS.registryConcurrencyPerScan;
  const registryProcessCap =
    inputs.registryProcessConcurrency ?? KNOWN_APPLICATION_LIMITS.registryProcessConcurrency;

  const unverifiedInputs: string[] = [];
  if (!isVerified(inputs.vercelMaxConcurrentExecutions)) unverifiedInputs.push("vercelMaxConcurrentExecutions");
  if (!isVerified(inputs.inngestGlobalConcurrency)) unverifiedInputs.push("inngestGlobalConcurrency");
  if (!isVerified(inputs.supabaseCapacityOpsPerSec)) unverifiedInputs.push("supabaseCapacityOpsPerSec");
  if (!isVerified(inputs.vercelInstanceCount)) unverifiedInputs.push("vercelInstanceCount");

  // --- Application-level limits (always computable, proven inputs) ---
  const inngestPerOrgLimit = inputs.organizationCount * inngestPerOrg;
  const requiredOrganizations = Math.ceil(targetActiveScans / inngestPerOrg);

  const knownLimits: Array<{ component: BottleneckComponent; value: number }> = [
    { component: "inngest_per_org", value: inngestPerOrgLimit },
  ];
  if (isVerified(inputs.vercelMaxConcurrentExecutions)) {
    knownLimits.push({ component: "vercel", value: inputs.vercelMaxConcurrentExecutions });
  }
  if (isVerified(inputs.inngestGlobalConcurrency)) {
    knownLimits.push({ component: "inngest_global", value: inputs.inngestGlobalConcurrency });
  }
  if (isVerified(inputs.supabaseCapacityOpsPerSec)) {
    // Convert a throughput ceiling into an equivalent active-scan ceiling using this workload's own DB-op rate.
    const dbOpsPerScanPerSec = inputs.averageDbOpsPerScan / (inputs.averageScanDurationMs / 1000);
    knownLimits.push({
      component: "supabase",
      value: Math.floor(inputs.supabaseCapacityOpsPerSec / Math.max(dbOpsPerScanPerSec, 0.0001)),
    });
  }

  const sortedKnown = [...knownLimits].sort((a, b) => a.value - b.value);
  const maxActiveScansFromKnownLimits = sortedKnown[0]?.value ?? inngestPerOrgLimit;
  const firstBottleneck = sortedKnown[0]?.component ?? "inngest_per_org";
  const secondBottleneck = sortedKnown[1]?.component ?? null;

  const allCriticalAccountInputsKnown =
    isVerified(inputs.vercelMaxConcurrentExecutions) &&
    isVerified(inputs.inngestGlobalConcurrency) &&
    isVerified(inputs.supabaseCapacityOpsPerSec);

  const maxActiveScans: Verifiable<number> = allCriticalAccountInputsKnown
    ? maxActiveScansFromKnownLimits
    : REQUIRES_ACCOUNT_VERIFICATION;

  const safetyMarginPct: Verifiable<number> = allCriticalAccountInputsKnown
    ? Math.round(((maxActiveScansFromKnownLimits - targetActiveScans) / targetActiveScans) * 100)
    : REQUIRES_ACCOUNT_VERIFICATION;

  // --- Throughput / completion time (application-level, always computable) ---
  const effectiveConcurrency = Math.min(maxActiveScansFromKnownLimits, targetActiveScans);
  const throughputAvgPerMinute = (effectiveConcurrency / (inputs.averageScanDurationMs / 1000)) * 60;
  const throughputP95PerMinute = (effectiveConcurrency / (inputs.p95ScanDurationMs / 1000)) * 60;
  const waves = Math.ceil(targetActiveScans / Math.max(effectiveConcurrency, 1));
  const completionAvgMs = waves * inputs.averageScanDurationMs;
  const completionP95Ms = waves * inputs.p95ScanDurationMs;

  // --- Registry pressure (application-level, always computable) ---
  const avgDeps = weightedAverageDependencies(mix) || inputs.averageDependencies;
  const theoreticalRequestsNoOverlap = targetActiveScans * avgDeps;
  const instanceCount = isVerified(inputs.vercelInstanceCount) ? inputs.vercelInstanceCount : null;
  const peakFleetWide: Verifiable<number> =
    instanceCount !== null ? instanceCount * registryProcessCap : REQUIRES_ACCOUNT_VERIFICATION;

  // --- DB pressure (application-level, always computable) ---
  const dbOpsPerMinute =
    (effectiveConcurrency * inputs.averageDbOpsPerScan) / (inputs.averageScanDurationMs / 1000 / 60);
  const dbOpsPerSecond = dbOpsPerMinute / 60;

  // --- Worker requirement (application-level model) ---
  const requiredExecutionSlots = Math.min(targetActiveScans, maxActiveScansFromKnownLimits);

  return {
    targetActiveScans,
    maxActiveScans,
    maxActiveScansFromKnownLimits,
    firstBottleneck,
    secondBottleneck,
    safetyMarginPct,
    requiredOrganizations,
    throughputPerMinute: { average: Math.round(throughputAvgPerMinute), p95: Math.round(throughputP95PerMinute) },
    completionTimeForTargetMs: { average: Math.round(completionAvgMs), p95: Math.round(completionP95Ms) },
    registryPressure: {
      theoreticalRequestsNoOverlap,
      peakPerInstance: registryProcessCap,
      peakFleetWide,
    },
    dbPressure: {
      opsPerMinute: Math.round(dbOpsPerMinute),
      opsPerSecond: Math.round(dbOpsPerSecond * 10) / 10,
      peakConcurrentRequests: effectiveConcurrency,
    },
    workerRequirement: { requiredExecutionSlots },
    unverifiedInputs,
  };
}

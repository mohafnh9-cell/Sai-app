import { DEFAULT_IGNORED_SEGMENTS, SOURCE_EXTENSIONS } from "./constants";

export interface ScanConfig {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  maxDurationMs: number;
  ignoredSegments: string[];
  includeExtensions?: string[];
  now: () => number;
}

export type ScanConfigInput = Partial<Omit<ScanConfig, "now">> & { now?: () => number };

/**
 * Sized for medium/large repos (this repo itself is ~1,850 scannable files /
 * ~7.5MB and must fit comfortably with room to grow). maxDurationMs stays
 * well under the 300s route budget in app/api/repositories/.../scans routes,
 * leaving headroom for fetch, scoring, and persistence.
 */
export const DEFAULT_SCAN_CONFIG: ScanConfig = {
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxFiles: 8_000,
  maxDurationMs: 120_000,
  ignoredSegments: DEFAULT_IGNORED_SEGMENTS,
  includeExtensions: [...SOURCE_EXTENSIONS],
  now: () => Date.now(),
};

export function resolveConfig(input: ScanConfigInput = {}): ScanConfig {
  return {
    ...DEFAULT_SCAN_CONFIG,
    ...input,
    ignoredSegments: [...(input.ignoredSegments ?? DEFAULT_SCAN_CONFIG.ignoredSegments)],
    now: input.now ?? DEFAULT_SCAN_CONFIG.now,
  };
}

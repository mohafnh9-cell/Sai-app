import { randomUUID } from "node:crypto";

/** Stable IDs for local-only verdict runs (not persisted to Supabase). */
export const LOCAL_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_REPOSITORY_ID = "00000000-0000-4000-8000-000000000002";

export function createLocalScanId(): string {
  return randomUUID();
}

export type LocalAnalysisScope = "workspace" | "working_tree" | "staged" | "diff";

export type LocalAnalysisSource = "local";

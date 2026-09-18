import { randomUUID } from "node:crypto";

/** Stable IDs for local-only verdict runs (not persisted to Supabase). */
export const LOCAL_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_REPOSITORY_ID = "00000000-0000-4000-8000-000000000002";
/** L1.1: SecurityEngine.execute()/EngineResult require an organizationId even for a local, unpersisted run. Real local identity is L1.2's job. */
export const LOCAL_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000003";

export function createLocalScanId(): string {
  return randomUUID();
}

export type LocalAnalysisScope = "workspace" | "working_tree" | "staged" | "diff";

export type LocalAnalysisSource = "local";

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isProductionReviewCancellable } from "@/lib/review/production-review-cancellable";

export type ActiveProductionReview = {
  scanId: string;
  scanJobId: string;
  projectId: string;
  organizationId: string;
  scanStatus: string;
  scanJobStatus: string;
  createdAt: string;
  startedAt: string | null;
  inngestRunId: string | null;
};

export async function getActiveProductionReviewForProject(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string }
): Promise<ActiveProductionReview | null> {
  const { data: job } = await admin
    .from("scan_jobs")
    .select("id, scan_id, status, organization_id, project_id, created_at, started_at, inngest_run_id")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!job?.scan_id) return null;

  const { data: scan } = await admin
    .from("scans")
    .select("id, status, repository_id, organization_id, project_id, created_at, started_at")
    .eq("id", job.scan_id as string)
    .eq("repository_id", input.projectId)
    .maybeSingle();

  if (!scan) return null;

  const scanStatus = String(scan.status ?? "");
  const scanJobStatus = String(job.status ?? "");

  if (
    !isProductionReviewCancellable({
      scanStatus,
      scanJobStatus,
    })
  ) {
    return null;
  }

  return {
    scanId: scan.id as string,
    scanJobId: job.id as string,
    projectId: input.projectId,
    organizationId: input.organizationId,
    scanStatus,
    scanJobStatus,
    createdAt: (job.created_at as string) ?? (scan.created_at as string),
    startedAt: (job.started_at as string | null) ?? (scan.started_at as string | null) ?? null,
    inngestRunId: (job.inngest_run_id as string | null) ?? null,
  };
}

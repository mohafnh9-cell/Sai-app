import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getScanRequestContext,
  ScanRequestError,
} from "@/server/security-scanner/request-context";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { buildScanProductionVerdict } from "@/server/brain/build-scan-verdict";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { maybeKickStuckQueuedScanRun } from "@/server/jobs/kick-stuck-scan-run";

const paramsSchema = z.object({
  repositoryId: z.string().uuid(),
  scanId: z.string().uuid(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string; scanId: string }> }
) {
  try {
    const rateLimited = enforceRateLimit(request);
    if (rateLimited) return rateLimited;

    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid repository or scan id" }, { status: 400 });
    }
    const { supabase } = await getScanRequestContext(parsed.data.repositoryId);
    const { data: scan, error: scanError } = await supabase
      .from("scans")
      .select("*")
      .eq("id", parsed.data.scanId)
      .eq("repository_id", parsed.data.repositoryId)
      .maybeSingle();
    if (scanError) throw new Error(scanError.message);
    if (!scan) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }

    const { data: findings, error: findingsError } = await supabase
      .from("scan_findings")
      .select("*")
      .eq("scan_id", scan.id)
      .order("severity", { ascending: true })
      .order("file_path", { ascending: true });
    if (findingsError) throw new Error(findingsError.message);

    let scanJob: { id: string; status: string; created_at?: string | null } | null = null;
    try {
      const admin = createAdminClient();
      const { data: job } = await admin
        .from("scan_jobs")
        .select("id, status, created_at")
        .eq("scan_id", scan.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (job?.id) {
        scanJob = {
          id: job.id as string,
          status: job.status as string,
          created_at: (job.created_at as string | null) ?? null,
        };
      }

      await maybeKickStuckQueuedScanRun(admin, { scan: scan as Record<string, unknown>, scanJob }).catch(
        () => undefined
      );

      if (scanJob) {
        const { data: refreshed } = await admin
          .from("scans")
          .select("*")
          .eq("id", scan.id)
          .maybeSingle();
        if (refreshed) {
          Object.assign(scan, refreshed);
        }
        const { data: jobRefresh } = await admin
          .from("scan_jobs")
          .select("id, status, created_at")
          .eq("id", scanJob.id)
          .maybeSingle();
        if (jobRefresh?.id) {
          scanJob = {
            id: jobRefresh.id as string,
            status: jobRefresh.status as string,
            created_at: (jobRefresh.created_at as string | null) ?? null,
          };
        }
      }
    } catch {
      scanJob = null;
    }

    let verdict = null;
    if (scan.status === "completed") {
      const categoryCounts: Record<string, number> = {};
      for (const row of findings ?? []) {
        const key = String(row.category ?? "unknown").toLowerCase();
        categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
      }

      const admin = createAdminClient();
      verdict = await buildScanProductionVerdict(admin, {
        scanId: scan.id,
        projectId: scan.project_id,
        organizationId: scan.organization_id,
        securityScore: scan.security_score,
        severityCounts: {
          critical: scan.critical_count ?? 0,
          high: scan.high_count ?? 0,
          medium: scan.medium_count ?? 0,
          low: scan.low_count ?? 0,
          info: scan.info_count ?? 0,
        },
        categoryCounts,
        findings: (findings ?? []).map((row) => ({
          title: row.title,
          severity: row.severity,
          recommendation: row.recommendation,
        })),
      });
    }

    return NextResponse.json({ scan, scanJob, findings, verdict });
  } catch (error) {
    if (error instanceof ScanRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error({
      component: "scan-detail-api",
      event: "request_failed",
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Could not load scan" }, { status: 500 });
  }
}

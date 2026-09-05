import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { AIRequestError, getScanAccessContext } from "@/server/ai-security-engine/request-context";
import { getReasoningOverlayForScan } from "@/server/ai-reasoning/persist";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const paramsSchema = z.object({ scanId: z.string().uuid() });

/**
 * Phase 30: read-only, tenant-scoped access to the AI reasoning overlay for
 * a scan. Never generates it (that happens automatically post-verdict, see
 * server/ai-reasoning/run-scan-reasoning.ts) -- this route only reads
 * whatever has already been persisted, scoped to the requesting user's
 * organization via getScanAccessContext (membership-checked, same guard the
 * existing ai-analysis route uses).
 */
export async function GET(request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    const rateLimited = await enforceRateLimit(request);
    if (rateLimited) return rateLimited;

    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid scan id" }, { status: 400 });
    }

    const access = await getScanAccessContext(parsed.data.scanId);
    const admin = createAdminClient();
    const overlay = await getReasoningOverlayForScan(admin, {
      organizationId: access.scan.organization_id as string,
      scanId: parsed.data.scanId,
    });

    return NextResponse.json({ aiReasoning: overlay });
  } catch (error) {
    if (error instanceof AIRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("ai_reasoning_read_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not load AI reasoning", code: "AI_REASONING_READ_FAILED" },
      { status: 500 }
    );
  }
}

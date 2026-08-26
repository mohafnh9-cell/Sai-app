import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import {
  AISecurityEngineError,
  loadScanIntelligence,
  runAISecurityAnalysis,
} from "@/server/ai-security-engine/pipeline";
import { AIRequestError, getScanAccessContext } from "@/server/ai-security-engine/request-context";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const paramsSchema = z.object({ scanId: z.string().uuid() });

function respond(error: unknown) {
  if (error instanceof AIRequestError || error instanceof AISecurityEngineError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error instanceof AIRequestError ? error.status : error.status }
    );
  }
  console.error("ai_analysis_failed", {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "unknown",
  });
  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "AI security analysis could not be completed",
      code: "AI_ANALYSIS_FAILED",
    },
    { status: 500 }
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ scanId: string }> }
) {
  try {
    const rateLimited = await enforceRateLimit(request);
    if (rateLimited) return rateLimited;

    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid scan id" }, { status: 400 });
    }
    await getScanAccessContext(parsed.data.scanId);
    const admin = createAdminClient();
    const intelligence = await loadScanIntelligence(admin, parsed.data.scanId);
    return NextResponse.json({ intelligence });
  } catch (error) {
    return respond(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ scanId: string }> }
) {
  try {
    const rateLimited = await enforceRateLimit(request);
    if (rateLimited) return rateLimited;

    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid scan id" }, { status: 400 });
    }
    const access = await getScanAccessContext(parsed.data.scanId);
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const admin = createAdminClient();

    if (!force) {
      const existing = await loadScanIntelligence(admin, parsed.data.scanId);
      if (existing?.report?.status === "completed") {
        return NextResponse.json({ intelligence: existing, cached: true }, { status: 200 });
      }
    } else {
      await admin.from("ai_reports").delete().eq("scan_id", parsed.data.scanId);
    }

    const { reportId } = await runAISecurityAnalysis(admin, parsed.data.scanId, access.locale);
    const intelligence = await loadScanIntelligence(admin, parsed.data.scanId);
    return NextResponse.json({ reportId, intelligence, cached: false }, { status: 201 });
  } catch (error) {
    return respond(error);
  }
}

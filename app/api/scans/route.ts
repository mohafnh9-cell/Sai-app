import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/server/http/rate-limit";

const deprecated = {
  error: "This endpoint is deprecated. Use POST /api/repositories/{projectId}/scans instead.",
  migration: "Block 5.5 — production readiness API",
};

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  return NextResponse.json(deprecated, { status: 410 });
}

export async function POST(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  return NextResponse.json(deprecated, { status: 410 });
}

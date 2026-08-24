import { NextResponse } from "next/server";
import { buildProtectedResourceMetadata } from "@/server/mcp/oauth/metadata";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimited = enforceRateLimit(request, { keyPrefix: "oauth-metadata" });
  if (rateLimited) return rateLimited;

  try {
    const metadata = buildProtectedResourceMetadata();
    return NextResponse.json(metadata, {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

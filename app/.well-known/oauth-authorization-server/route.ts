import { NextResponse } from "next/server";
import { buildAuthorizationServerMetadata } from "@/server/mcp/oauth/metadata";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request, { keyPrefix: "oauth-metadata" });
  if (rateLimited) return rateLimited;

  try {
    const metadata = buildAuthorizationServerMetadata();
    return NextResponse.json(metadata, {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

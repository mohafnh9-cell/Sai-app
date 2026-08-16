import { NextResponse } from "next/server";
import { buildAuthorizationServerMetadata } from "@/server/mcp/oauth/metadata";

export const runtime = "nodejs";

export async function GET() {
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

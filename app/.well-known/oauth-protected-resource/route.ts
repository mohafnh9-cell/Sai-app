import { NextResponse } from "next/server";
import { buildProtectedResourceMetadata } from "@/server/mcp/oauth/metadata";

export const runtime = "nodejs";

export async function GET() {
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

import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { registerOAuthClient, isDcrEnabled } from "@/server/mcp/oauth/clients";
import { OAuthError, oauthErrorResponse } from "@/server/mcp/oauth/errors";
import { logOAuthEvent, clientIp } from "@/server/mcp/oauth/audit";
import { z } from "zod";

export const runtime = "nodejs";

const registerBodySchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string()).optional(),
  client_type: z.enum(["public", "confidential"]).optional(),
});

const OAUTH_REGISTER_RATE_LIMIT = {
  keyPrefix: "oauth-register",
  limit: 10,
  windowMs: 60_000,
};

export async function POST(request: Request) {
  if (!isDcrEnabled()) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "Dynamic client registration is disabled" },
      { status: 403 }
    );
  }

  const rateLimited = await enforceRateLimit(request, OAUTH_REGISTER_RATE_LIMIT);
  if (rateLimited) return rateLimited;

  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = registerBodySchema.safeParse(rawBody);
    if (!rawBody || !parsed.success) {
      throw new OAuthError("invalid_request", "Invalid JSON body");
    }
    const body = parsed.data;

    const client = await registerOAuthClient({
      client_name: body.client_name ?? "",
      redirect_uris: body.redirect_uris ?? [],
      client_type: body.client_type,
    });

    logOAuthEvent({
      eventType: "oauth.client.registered",
      clientId: client.client_id,
      result: "success",
      ip: clientIp(request),
      metadata: { clientName: client.client_name },
    });

    return NextResponse.json(
      {
        client_id: client.client_id,
        client_name: client.client_name,
        client_type: client.client_type,
        redirect_uris: client.redirect_uris,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof OAuthError) {
      return oauthErrorResponse(error);
    }
    console.error("[oauth/register] unexpected error");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

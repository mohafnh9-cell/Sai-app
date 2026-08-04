import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateMcpApiKey } from "@/server/mcp/auth";
import { resolveActiveWorkspaceIdForUser } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(80).default("Cursor Connection"),
});

export async function GET(request: Request) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = await resolveActiveWorkspaceIdForUser(supabase, user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const { data: keys } = await supabase
    .from("mcp_api_keys")
    .select("id, name, key_prefix, last_used_at, revoked_at, created_at")
    .eq("organization_id", organizationId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  return NextResponse.json({ keys: keys ?? [] });
}

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 422 });
  }

  const organizationId = await resolveActiveWorkspaceIdForUser(supabase, user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const { rawKey, prefix, hash } = generateMcpApiKey();
  const admin = createAdminClient();
  const { data: key, error } = await admin
    .from("mcp_api_keys")
    .insert({
      organization_id: organizationId,
      created_by_user_id: user.id,
      name: parsed.data.name,
      key_prefix: prefix,
      key_hash: hash,
    })
    .select("id, name, key_prefix, created_at")
    .single();

  if (error || !key) {
    return NextResponse.json({ error: "Could not create API key" }, { status: 500 });
  }

  return NextResponse.json({
    key: {
      ...key,
      rawKey,
    },
    message: "Copy this key now — it will not be shown again.",
  });
}

export async function DELETE(request: Request) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const keyId = searchParams.get("id");
  if (!keyId) {
    return NextResponse.json({ error: "Missing key id" }, { status: 400 });
  }

  const organizationId = await resolveActiveWorkspaceIdForUser(supabase, user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const { error } = await supabase
    .from("mcp_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("organization_id", organizationId)
    .is("revoked_at", null);

  if (error) {
    return NextResponse.json({ error: "Could not revoke key" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

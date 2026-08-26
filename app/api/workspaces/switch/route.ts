import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { switchActiveWorkspace } from "@/server/workspaces/mutations";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

const switchSchema = z.object({
  workspaceId: z.string().uuid(),
});

export async function POST(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = switchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid workspace id", code: "validation" },
      { status: 422 }
    );
  }

  const result = await switchActiveWorkspace(
    auth.supabase,
    auth.user.id,
    parsed.data.workspaceId
  );

  if (!result.ok) {
    const status =
      result.code === "forbidden" ? 403 : result.code === "unauthorized" ? 401 : 500;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  return NextResponse.json({ workspaceId: result.workspaceId });
}

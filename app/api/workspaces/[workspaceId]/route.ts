import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { deleteWorkspaceForUser } from "@/server/workspaces/mutations";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

const workspaceParamsSchema = z.object({
  workspaceId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ workspaceId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const { workspaceId: rawWorkspaceId } = await context.params;
  const parsed = workspaceParamsSchema.safeParse({ workspaceId: rawWorkspaceId });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid workspace id", code: "validation" }, { status: 422 });
  }

  const result = await deleteWorkspaceForUser(
    auth.supabase,
    auth.user.id,
    parsed.data.workspaceId
  );

  if (!result.ok) {
    const status =
      result.code === "validation"
        ? 422
        : result.code === "forbidden" || result.code === "last_workspace"
          ? 403
          : 500;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  return NextResponse.json({ nextActiveWorkspaceId: result.nextActiveWorkspaceId });
}

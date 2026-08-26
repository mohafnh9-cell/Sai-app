import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { getCachedOrgBrain } from "@/server/brain/build-org-brain";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.organizationId) {
    return NextResponse.json({ error: "No organization" }, { status: 404 });
  }

  const brain = await getCachedOrgBrain(auth.supabase, auth.organizationId);

  return NextResponse.json(
    { brain },
    {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    }
  );
}

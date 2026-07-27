import { NextResponse } from "next/server";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { getProjectAccessForUser } from "@/server/projects/project-access";
import { getMissionControlView } from "@/server/mission-control/get-mission-control";
import { isFeatureEnabled } from "@/server/feature-flags";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id: projectId } = await params;
  const auth = await getCachedServerAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isFeatureEnabled("mission_control", { organizationId: auth.organizationId })) {
    return NextResponse.json({ error: "Mission Control is not enabled" }, { status: 404 });
  }

  const project = await getProjectAccessForUser(auth.supabase, projectId, auth.user.id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { view, verdict } = await getMissionControlView(
    auth.supabase,
    projectId,
    auth.organizationId
  );

  return NextResponse.json({ view, verdict });
}

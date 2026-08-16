import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { assertProjectInOrg, McpError, resolveMcpAuth } from "@/server/mcp/auth";

export type CiProjectAccess = {
  project: {
    id: string;
    organization_id: string;
    name?: string | null;
    github_repo: string | null;
  };
  userId: string;
  admin: SupabaseClient;
  authSource: "session" | "api_key" | "oauth";
};

type CiAccessOk = { ok: true; access: CiProjectAccess };
type CiAccessFail = { ok: false; response: NextResponse };

/** Session cookie or Bearer MCP token (seq_live_* / OAuth) for CI endpoints. */
export async function requireCiProjectAccess(
  request: Request,
  projectId: string
): Promise<CiAccessOk | CiAccessFail> {
  const mcpAuth = await resolveMcpAuth(request);
  if (mcpAuth) {
    try {
      const project = await assertProjectInOrg(mcpAuth.admin, mcpAuth.organizationId, projectId);
      return {
        ok: true,
        access: {
          project: {
            id: project.id,
            organization_id: project.organization_id,
            name: project.name,
            github_repo: project.github_repo,
          },
          userId: mcpAuth.userId,
          admin: mcpAuth.admin,
          authSource: mcpAuth.authType === "api_key" ? "api_key" : "oauth",
        },
      };
    } catch (error) {
      if (error instanceof McpError) {
        return {
          ok: false,
          response: NextResponse.json(
            { ok: false, error: error.message, code: error.code },
            { status: error.status }
          ),
        };
      }
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
      };
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sessionAccess = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!sessionAccess.ok) {
    return { ok: false, response: sessionAccess.response };
  }

  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Service unavailable", code: "ADMIN_CLIENT_UNAVAILABLE" },
        { status: 503 }
      ),
    };
  }

  const { data: project } = await admin
    .from("projects")
    .select("id, organization_id, name, github_repo")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Not found" }, { status: 404 }),
    };
  }

  return {
    ok: true,
    access: {
      project: project as CiProjectAccess["project"],
      userId: sessionAccess.userId,
      admin,
      authSource: "session",
    },
  };
}

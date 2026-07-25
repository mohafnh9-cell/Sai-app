import { NextResponse } from "next/server";
import { z } from "zod";
import { getGitHubRepoById, type GitHubRepo } from "@/lib/github";
import { gitHubRepositoryReferenceFromApi } from "@/lib/github/repository-reference";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import {
  registerProjectWebhook,
  webhookErrorMessage,
} from "@/server/github-automation/register-webhook";
import { resolveUserOrganizationId } from "@/server/organizations/resolve-user-organization";
import { resolveActiveWorkspaceIdForUser, assertWorkspaceMembership } from "@/server/workspaces/service";
import { switchActiveWorkspace } from "@/server/workspaces/mutations";
import { resolveWorkspaceGitHubToken } from "@/server/github/workspace-connection-service";
import { enforceRateLimit } from "@/server/http/rate-limit";

const requestSchema = z.object({
  organizationId: z.string().uuid().optional(),
  repos: z
    .array(z.object({ id: z.number().int().positive() }).passthrough())
    .min(1)
    .max(100),
});

const MISSING_COLUMN_CODES = new Set(["PGRST204", "42703"]);

function isMissingColumnError(code?: string) {
  return Boolean(code && MISSING_COLUMN_CODES.has(code));
}

function baseProjectFields(repo: GitHubRepo, organizationId: string) {
  const reference = gitHubRepositoryReferenceFromApi(repo);
  return {
    organization_id: organizationId,
    name: repo.name,
    github_repo: reference.htmlUrl,
    description: repo.description,
  };
}

function extendedProjectFields(repo: GitHubRepo) {
  return {
    github_repository_id: repo.id,
    github_is_private: repo.private,
    github_default_branch: repo.default_branch,
    github_connected_at: new Date().toISOString(),
  };
}

async function upsertConnectedProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  repo: GitHubRepo,
  connectionMeta?: { connectionId: string; connectedByUserId: string }
): Promise<string> {
  const reference = gitHubRepositoryReferenceFromApi(repo);
  const { data: existingById } = await supabase
    .from("projects")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("github_repository_id", repo.id)
    .maybeSingle();

  let existingProjectId = existingById?.id as string | undefined;
  if (!existingProjectId) {
    const { data: existingByUrl } = await supabase
      .from("projects")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("github_repo", reference.htmlUrl)
      .maybeSingle();
    existingProjectId = existingByUrl?.id as string | undefined;
  }

  if (existingProjectId) {
    const extended = {
      name: repo.name,
      description: repo.description,
      ...extendedProjectFields(repo),
      ...(connectionMeta
        ? {
            github_connection_id: connectionMeta.connectionId,
            connected_by_user_id: connectionMeta.connectedByUserId,
          }
        : {}),
    };
    let { error } = await supabase
      .from("projects")
      .update({
        ...extended,
        github_repo: reference.htmlUrl,
      })
      .eq("id", existingProjectId)
      .eq("organization_id", organizationId);

    if (error && isMissingColumnError(error.code)) {
      ({ error } = await supabase
        .from("projects")
        .update({
          name: repo.name,
          description: repo.description,
        })
        .eq("id", existingProjectId)
        .eq("organization_id", organizationId));
    }

    if (error) {
      console.error("github_connect_project_update_failed", {
        code: error.code,
        projectId: existingProjectId,
      });
      throw new Error("Could not update the connected repository in Supabase");
    }
    return existingProjectId;
  }

  const fullInsert = {
    ...baseProjectFields(repo, organizationId),
    ...extendedProjectFields(repo),
    ...(connectionMeta
      ? {
          github_connection_id: connectionMeta.connectionId,
          connected_by_user_id: connectionMeta.connectedByUserId,
        }
      : {}),
  };
  let insertResult = await supabase.from("projects").insert(fullInsert).select("id").single();

  if (insertResult.error && isMissingColumnError(insertResult.error.code)) {
    insertResult = await supabase
      .from("projects")
      .insert(baseProjectFields(repo, organizationId))
      .select("id")
      .single();
  }

  if (insertResult.error || !insertResult.data) {
    console.error("github_connect_project_insert_failed", {
      code: insertResult.error?.code,
      organizationId,
    });
    throw new Error("Could not save the repository in Supabase");
  }

  return insertResult.data.id;
}

async function connectRepositories(request: Request) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid repository selection" }, { status: 422 });
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  void session;

  const organizationId = parsed.data.organizationId
    ? await resolveUserOrganizationId(supabase, user.id, parsed.data.organizationId)
    : await resolveActiveWorkspaceIdForUser(supabase, user.id);
  if (!organizationId) {
    return NextResponse.json(
      { error: "No active Workspace", code: "workspace_not_found" },
      { status: 404 }
    );
  }

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "GitHub integration is not configured", code: "internal_error" },
      { status: 500 }
    );
  }

  const tokenResult = await resolveWorkspaceGitHubToken(admin, organizationId);
  if (!tokenResult) {
    return NextResponse.json(
      {
        error: "Connect GitHub to this Workspace before selecting repositories.",
        code: "github_not_connected",
        needsReauth: true,
      },
      { status: 403 }
    );
  }
  const providerToken = tokenResult.token;

  const selectedIds = [...new Set(parsed.data.repos.map((repo) => repo.id))];
  const verifiedRepos = await Promise.all(
    selectedIds.map((repoId) => getGitHubRepoById(providerToken, repoId))
  );
  if (verifiedRepos.some((repo) => !repo)) {
    return NextResponse.json(
      { error: "Repository access could not be verified", code: "repository_not_authorized" },
      { status: 403 }
    );
  }

  for (const repo of verifiedRepos) {
    if (!repo) continue;
    const { data: duplicate } = await admin
      .from("projects")
      .select("id, organization_id")
      .eq("github_repository_id", repo.id)
      .neq("organization_id", organizationId)
      .limit(1)
      .maybeSingle();
    if (duplicate) {
      const canAccessExistingWorkspace = await assertWorkspaceMembership(
        supabase,
        user.id,
        duplicate.organization_id
      );
      if (canAccessExistingWorkspace) {
        const switched = await switchActiveWorkspace(supabase, user.id, duplicate.organization_id);
        if (switched.ok) {
          return NextResponse.json({
            saved: 0,
            projectIds: [duplicate.id],
            total: selectedIds.length,
            recovered: true,
            workspaceId: duplicate.organization_id,
            webhooksCreated: 0,
            webhooksExisting: 0,
            webhooksSkipped: 0,
            webhookWarnings: [],
          });
        }
      }
      return NextResponse.json(
        {
          error: "This repository is already connected to another Workspace.",
          code: "repository_already_connected",
        },
        { status: 409 }
      );
    }
  }

  let saved = 0;
  const projectIds: string[] = [];
  let webhooksCreated = 0;
  let webhooksExisting = 0;
  let webhooksSkipped = 0;
  const webhookWarnings: string[] = [];

  for (const repo of verifiedRepos) {
    if (!repo) continue;
    const projectId = await upsertConnectedProject(supabase, organizationId, repo, {
      connectionId: tokenResult.connectionId,
      connectedByUserId: tokenResult.userId,
    });
    projectIds.push(projectId);
    saved++;

    if (!admin) {
      webhooksSkipped++;
      webhookWarnings.push(`${repo.full_name}: automation service not configured`);
      continue;
    }

    try {
      const result = await registerProjectWebhook(admin, {
        accessToken: providerToken,
        organizationId,
        projectId,
        repo,
      });
      if (result.status === "created") webhooksCreated++;
      else if (result.status === "existing") webhooksExisting++;
      else {
        webhooksSkipped++;
        webhookWarnings.push(`${repo.full_name}: ${result.reason}`);
      }
    } catch (error) {
      webhooksSkipped++;
      webhookWarnings.push(`${repo.full_name}: ${webhookErrorMessage(error)}`);
      console.warn("github_webhook_register_failed", {
        repo: repo.full_name,
        message: webhookErrorMessage(error),
      });
    }
  }

  return NextResponse.json({
    saved,
    projectIds,
    total: selectedIds.length,
    webhooksCreated,
    webhooksExisting,
    webhooksSkipped,
    webhookWarnings,
  });
}

export async function POST(request: Request) {
  try {
    return await connectRepositories(request);
  } catch (error) {
    console.error("github_connect_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not connect the selected repositories",
      },
      { status: 500 }
    );
  }
}

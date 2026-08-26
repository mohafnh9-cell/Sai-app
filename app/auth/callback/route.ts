import { createClient } from "@/lib/supabase/server";
import { saveGitHubToken } from "@/lib/github/token-store";
import {
  githubOAuthStateCookieName,
  parseGitHubOAuthState,
} from "@/lib/github/oauth-state";
import { upsertWorkspaceGitHubConnection } from "@/server/github/workspace-connection-service";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { NextRequest, NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import {
  resolveGitHubOAuthErrorRedirect,
  resolveGitHubOAuthSuccessRedirect,
} from "@/lib/github/oauth-redirect";
import { enforceRateLimit } from "@/server/http/rate-limit";

function redirectOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const origin = redirectOrigin(request);
  const cookieNext = request.cookies.get("sequrai_auth_next")?.value;
  const next = safeNextPath(
    cookieNext ? decodeURIComponent(cookieNext) : searchParams.get("next"),
    "/onboarding"
  );

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error || !data.session || !data.user) {
      console.error("auth_callback_exchange_failed", { code: error?.code });
      return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
    }

    if (data.session.provider_token) {
      try {
        await saveGitHubToken(
          data.user.id,
          data.session.provider_token,
          data.session.provider_refresh_token
        );
      } catch (tokenError) {
        console.error("auth_callback_token_store_failed", {
          name: tokenError instanceof Error ? tokenError.name : "UnknownError",
        });
      }
    }

    const oauthStateRaw = request.cookies.get(githubOAuthStateCookieName)?.value;
    const oauthState = parseGitHubOAuthState(oauthStateRaw);
    let redirectPath = next;

    if (oauthState && data.session.provider_token) {
      if (oauthState.userId !== data.user.id) {
        redirectPath = resolveGitHubOAuthErrorRedirect(next, "oauth_state_invalid");
      } else {
        const allowed = await assertWorkspaceMembership(
          supabase,
          data.user.id,
          oauthState.workspaceId
        );
        if (!allowed) {
          redirectPath = resolveGitHubOAuthErrorRedirect(next, "workspace_access_denied");
        } else {
          try {
            await upsertWorkspaceGitHubConnection({
              organizationId: oauthState.workspaceId,
              connectedByUserId: data.user.id,
              accessToken: data.session.provider_token,
              refreshToken: data.session.provider_refresh_token,
            });
            redirectPath = resolveGitHubOAuthSuccessRedirect(next);
          } catch (connectionError) {
            console.error("auth_callback_workspace_connection_failed", {
              name:
                connectionError instanceof Error
                  ? connectionError.name
                  : "UnknownError",
            });
            redirectPath = resolveGitHubOAuthErrorRedirect(next, "github_connection_failed");
          }
        }
      }
    }

    const response = NextResponse.redirect(`${origin}${redirectPath}`);
    response.cookies.delete("sequrai_auth_next");
    response.cookies.delete(githubOAuthStateCookieName);
    return response;
  } catch (callbackError) {
    console.error("auth_callback_failed", {
      name: callbackError instanceof Error ? callbackError.name : "UnknownError",
    });
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }
}

/** Header carrying the workspace the client is SHOWING, checked by server/workspaces/explicit-context.ts on workspace-scoped writes. */
export const WORKSPACE_CONTEXT_HEADER = "x-sequrai-workspace-id";
export const WORKSPACE_MISMATCH_CODE = "workspace_context_mismatch";

/**
 * Same-origin write endpoints that act on "the current workspace" (cookie-resolved on the server). The client states the workspace it
 * shows on these, and refuses to send them while it knows the shown workspace is no longer the active one.
 */
export const WORKSPACE_SCOPED_WRITE_PREFIXES = [
  "/api/mcp/keys",
  "/api/github/connect",
  "/api/github/connection",
  "/api/github/oauth/prepare",
  "/api/github/app/attach",
  "/api/stripe/",
  "/api/uploads/analyze",
] as const;

export function isWorkspaceScopedWrite(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  return WORKSPACE_SCOPED_WRITE_PREFIXES.some((prefix) => {
    const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return pathname === base || pathname.startsWith(`${base}/`);
  });
}

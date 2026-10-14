"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/client";
import { WORKSPACE_CONTEXT_HEADER, WORKSPACE_MISMATCH_CODE, isWorkspaceScopedWrite } from "@/lib/workspaces/context-header";

/**
 * Which workspace this tab SHOWS, and whether it is known to have gone stale (another tab switched the shared active workspace).
 * While stale: workspace-scoped writes are refused before they are sent, text already typed is left untouched, and a notice explains
 * what to do. The server enforces the same rule independently (server/workspaces/explicit-context.ts).
 */
type Conflict = { activeWorkspaceId: string | null } | null;

let shownWorkspaceId: string | null = null;
let conflict: Conflict = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const getShownWorkspaceId = () => shownWorkspaceId;
export const getWorkspaceConflict = (): Conflict => conflict;
export function reportWorkspaceConflict(activeWorkspaceId: string | null) {
  if (conflict?.activeWorkspaceId === activeWorkspaceId && conflict) return;
  conflict = { activeWorkspaceId };
  emit();
}
export function useWorkspaceConflict(): Conflict {
  return useSyncExternalStore(subscribe, () => conflict, () => null);
}
/** Test hook. */
export function resetWorkspaceContextForTests() { shownWorkspaceId = null; conflict = null; emit(); }

/** XHR counterpart of the fetch guard (uploads need upload progress). Returns false when the request must not be sent. */
export function applyWorkspaceContextToXhr(xhr: XMLHttpRequest): boolean {
  if (conflict) return false;
  if (shownWorkspaceId) xhr.setRequestHeader(WORKSPACE_CONTEXT_HEADER, shownWorkspaceId);
  return true;
}

let installed = false;
function installFetchGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try { url = new URL(raw, window.location.href); } catch { return original(input, init); }
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (url.origin !== window.location.origin || !shownWorkspaceId || !isWorkspaceScopedWrite(url.pathname, method)) {
      return original(input, init);
    }
    if (conflict) {
      return new Response(
        JSON.stringify({ error: "The workspace changed in another tab. Reload before sending.", code: "workspace_context_blocked", activeWorkspaceId: conflict.activeWorkspaceId }),
        { status: 409, headers: { "content-type": "application/json" } }
      );
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(WORKSPACE_CONTEXT_HEADER, shownWorkspaceId);
    const response = await original(input instanceof Request ? new Request(input, { headers }) : input, input instanceof Request ? undefined : { ...init, headers });
    if (response.status === 409) {
      const body = (await response.clone().json().catch(() => null)) as { code?: string; activeWorkspaceId?: string } | null;
      if (body?.code === WORKSPACE_MISMATCH_CODE) reportWorkspaceConflict(body.activeWorkspaceId ?? null);
    }
    return response;
  };
}

function ConflictNotice() {
  const { t } = useI18n("workspace");
  const current = useWorkspaceConflict();
  if (!current) return null;
  return (
    <div
      role="alert"
      data-testid="workspace-context-notice"
      className="fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center justify-center gap-3 border-b border-warning/40 bg-warning/15 px-4 py-2 text-sm text-foreground backdrop-blur"
    >
      <span className="font-medium">{t("contextChanged.title")}</span>
      <span className="text-muted-foreground">{t("contextChanged.body")}</span>
      <button type="button" className="rounded-md border px-3 py-1 text-sm font-medium" onClick={() => window.location.reload()}>
        {t("contextChanged.reload")}
      </button>
    </div>
  );
}

export function WorkspaceContextProvider({ workspaceId, children }: { workspaceId: string | null; children: ReactNode }) {
  useEffect(() => {
    shownWorkspaceId = workspaceId;
    installFetchGuard();
    emit();
  }, [workspaceId]);
  return (
    <>
      <ConflictNotice />
      {children}
    </>
  );
}

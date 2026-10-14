// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/i18n/client", () => ({ useI18n: () => ({ t: (k: string) => k, locale: "es" }) }));
vi.mock("@/features/demo/use-demo-navigation", () => ({ useDemoNavigation: () => ({ isDemo: false }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never) }));

import { WorkspaceSwitcher } from "../WorkspaceSwitcher";
import { getWorkspaceConflict, resetWorkspaceContextForTests } from "@/lib/workspaces/workspace-context";

// Two-tab scenario of the Proyectos mismatch: this tab was rendered for workspace A; another tab switched the shared cookie to B.
const A = { id: "a", name: "Workspace A" };
const B = { id: "b", name: "Workspace B" };
const initialWorkspaces = [A, B] as never;

let root: Root; let container: HTMLElement; const reload = vi.fn();
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
function serverActive(id: string) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ workspaces: [A, B], activeWorkspaceId: id }) })));
}
beforeEach(() => {
  reload.mockReset(); window.sessionStorage.clear(); resetWorkspaceContextForTests();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload, assign: vi.fn() } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root.render(createElement(WorkspaceSwitcher, { initialWorkspaces, initialActiveWorkspaceId: "a" })));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("WorkspaceSwitcher cross-tab sync", () => {
  it("reloads when the server's active workspace differs from the one shown, on returning to the tab", async () => {
    serverActive("b");
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does nothing when they agree", async () => {
    serverActive("a");
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps what is shown when the check fails (offline / 500)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(reload).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload repeatedly: a second focus right after the reload (layout still disagreeing) is ignored", async () => {
    serverActive("b");
    for (let i = 0; i < 4; i++) { await act(async () => { window.dispatchEvent(new Event("focus")); }); await flush(); }
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("after the reload the tab is rendered for B and stays put", async () => {
    serverActive("b");
    act(() => root.render(createElement(WorkspaceSwitcher, { initialWorkspaces, initialActiveWorkspaceId: "b" })));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(reload).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Workspace B");
  });

  it("with text typed: no reload, the text stays, and the tab is marked stale so workspace-scoped sends pause", async () => {
    serverActive("b");
    const input = document.createElement("input"); input.type = "text"; document.body.append(input); input.focus(); input.value = "my notes";
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(reload).not.toHaveBeenCalled();
    expect(input.value).toBe("my notes");
    expect(getWorkspaceConflict()).toEqual({ activeWorkspaceId: "b" });
    input.remove();
  });

  it("without typing: reloads and does not mark the tab stale", async () => {
    serverActive("b");
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(getWorkspaceConflict()).toBeNull();
  });

  it("when the reload was already done once and the layout still disagrees: stays put and marks the tab stale", async () => {
    serverActive("b");
    for (let i = 0; i < 3; i++) { await act(async () => { window.dispatchEvent(new Event("focus")); }); await flush(); }
    expect(reload).toHaveBeenCalledTimes(1);
    expect(getWorkspaceConflict()).toEqual({ activeWorkspaceId: "b" });
  });
});

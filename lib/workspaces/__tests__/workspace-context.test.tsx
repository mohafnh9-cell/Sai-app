// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/lib/i18n/client", () => ({ useI18n: () => ({ t: (k: string) => k, locale: "en" }) }));

import { WorkspaceContextProvider, reportWorkspaceConflict, resetWorkspaceContextForTests, applyWorkspaceContextToXhr } from "../workspace-context";

// The provider wraps window.fetch once per page. The wrapper forwards to the fetch that was current when it was installed, so the test
// installs it over a single stable spy and only changes what that spy answers.
const network = vi.fn();
window.fetch = network as never;
let root: Root; let container: HTMLElement;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

beforeEach(() => {
  network.mockReset();
  network.mockImplementation(async () => ok());
  resetWorkspaceContextForTests();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function mount(workspaceId: string | null = "ws-a") {
  act(() => root.render(createElement(WorkspaceContextProvider, { workspaceId }, createElement("input", { id: "notes" }))));
  await flush();
}
const headersOf = (call: unknown[]) => new Headers((call[1] as RequestInit | undefined)?.headers);

describe("WorkspaceContextProvider fetch guard", () => {
  it("states the shown workspace on workspace-scoped writes only", async () => {
    await mount("ws-a");
    await window.fetch("/api/mcp/keys", { method: "POST", body: "{}" });
    expect(headersOf(network.mock.calls[0]!).get("x-sequrai-workspace-id")).toBe("ws-a");
    network.mockClear();
    await window.fetch("/api/mcp/keys"); // GET
    await window.fetch("/api/projects/p1/safe-fixes/f1", { method: "POST" }); // explicit by URL, not workspace-scoped
    expect(network).toHaveBeenCalledTimes(2);
    for (const call of network.mock.calls) expect(headersOf(call).get("x-sequrai-workspace-id")).toBeNull();
  });

  it("while the tab is known to be stale: refuses to send, keeps typed text, shows the notice", async () => {
    await mount("ws-a");
    const input = container.querySelector("#notes") as HTMLInputElement;
    input.focus(); input.value = "unsaved text";
    await act(async () => { reportWorkspaceConflict("ws-b"); });
    network.mockClear();
    const res = await window.fetch("/api/github/connect", { method: "POST", body: "{}" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("workspace_context_blocked");
    expect(network).not.toHaveBeenCalled(); // nothing left the browser
    expect(input.value).toBe("unsaved text");
    expect(document.querySelector('[data-testid="workspace-context-notice"]')?.getAttribute("role")).toBe("alert");
  });

  it("a server 409 workspace_context_mismatch (request in flight during the switch) marks the tab stale and blocks the next send", async () => {
    await mount("ws-a");
    network.mockImplementationOnce(async () => new Response(JSON.stringify({ code: "workspace_context_mismatch", activeWorkspaceId: "ws-b" }), { status: 409 }));
    const first = await window.fetch("/api/stripe/checkout", { method: "POST" });
    expect(first.status).toBe(409);
    await flush();
    expect(document.querySelector('[data-testid="workspace-context-notice"]')).not.toBeNull();
    network.mockClear();
    const second = await window.fetch("/api/stripe/checkout", { method: "POST" });
    expect((await second.json()).code).toBe("workspace_context_blocked");
    expect(network).not.toHaveBeenCalled();
  });

  it("uploads (XHR) get the header, and are refused while stale", async () => {
    await mount("ws-a");
    const xhr = { setRequestHeader: vi.fn() } as unknown as XMLHttpRequest;
    expect(applyWorkspaceContextToXhr(xhr)).toBe(true);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("x-sequrai-workspace-id", "ws-a");
    await act(async () => { reportWorkspaceConflict("ws-b"); });
    expect(applyWorkspaceContextToXhr({ setRequestHeader: vi.fn() } as unknown as XMLHttpRequest)).toBe(false);
  });
});

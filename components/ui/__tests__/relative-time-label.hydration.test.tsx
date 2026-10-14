// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement, act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lookup = (ns: string | undefined, key: string, params?: Record<string, unknown>) => {
  const segments = key.split(".");
  const namespace = ns ?? segments.shift()!;
  let node: unknown = JSON.parse(readFileSync(`messages/es/${namespace}.json`, "utf8"));
  for (const part of segments) node = (node as Record<string, unknown>)?.[part];
  if (typeof node !== "string") throw new Error(`missing i18n key es:${namespace}.${segments.join(".")}`);
  return node.replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? String(params[k]) : m));
};
vi.mock("@/lib/i18n/client", () => ({
  useI18n: (ns?: string) => ({ t: (key: string, params?: Record<string, unknown>) => lookup(ns, key, params), locale: "es" }),
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never) }));

import { RelativeTimeLabel } from "../relative-time-label";
import { MissionControlHistorySection } from "@/features/mission-control/components/MissionControlHistorySection";
import { formatRelativeLocalized } from "@/lib/i18n/format";

// Acceptance of 2026-10-13/14: "Minified React error #418; args[]=text" on /mission-control. The page prints times relative to now from
// components that are server-rendered AND hydrated. These tests render on the "server" at one instant and hydrate at another that crosses a
// minute or hour boundary, with React itself: no recoverable hydration error, no console error, and the text is correct (not stale) after.

const LABELS = { never: "nunca", justNow: "ahora", minutesAgo: "hace {count} min", hoursAgo: "hace {count} h", daysAgo: "hace {count} d" };
const mounted: Array<{ root: Root; container: HTMLElement }> = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function serverThenHydrate(
  tree: () => ReturnType<typeof createElement>,
  serverAt: string,
  clientAt: string
) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(serverAt));
  const html = renderToString(tree());
  vi.setSystemTime(new Date(clientAt));
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const recoverable: string[] = [];
  const consoleErrors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args) => { consoleErrors.push(args.map(String).join(" ").slice(0, 200)); });
  let root!: Root;
  await act(async () => {
    root = hydrateRoot(container, tree(), { onRecoverableError: (e) => recoverable.push(String((e as Error).message).slice(0, 120)) });
  });
  mounted.push({ root, container });
  return { html, container, recoverable, consoleErrors };
}

const label = (iso: string, locale = "es") =>
  createElement(RelativeTimeLabel, { iso, format: (now: Date) => formatRelativeLocalized(locale as "es", iso, LABELS, now) });

describe("deterministic first render", () => {
  it("hour boundary between server render and hydration (19 h 59 min -> 20 h): no hydration error, no console error, and the text is right afterwards", async () => {
    const iso = "2026-10-13T10:17:00Z";
    const r = await serverThenHydrate(() => label(iso), "2026-10-14T06:16:58Z", "2026-10-14T06:17:04Z");
    expect(r.html).toContain("2026-10-13 10:17 UTC"); // what the server (and the first client render) show: a pure function of the instant
    expect(r.html).not.toMatch(/hace/);
    expect(r.recoverable).toEqual([]);
    expect(r.consoleErrors).toEqual([]);
    const time = r.container.querySelector("time")!;
    expect(time.textContent).toBe("hace 20 h"); // updated after mount with the client's clock, not the server's "19 h"
    expect(time.getAttribute("datetime")).toBe("2026-10-13T10:17:00.000Z");
    expect(time.getAttribute("title")).toBe("2026-10-13 10:17 UTC"); // the full date stays reachable
  });

  it("minute boundary (4 min 58 s -> 5 min 3 s): same guarantees", async () => {
    const iso = "2026-10-14T06:13:00Z";
    const r = await serverThenHydrate(() => label(iso), "2026-10-14T06:17:58Z", "2026-10-14T06:18:03Z");
    expect(r.recoverable).toEqual([]);
    expect(r.consoleErrors).toEqual([]);
    expect(r.container.querySelector("time")!.textContent).toBe("hace 5 min");
  });

  it("the server HTML does not depend on the server's clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T06:16:58Z"));
    const a = renderToString(label("2026-10-13T10:17:00Z"));
    vi.setSystemTime(new Date("2026-10-20T23:59:59Z"));
    const b = renderToString(label("2026-10-13T10:17:00Z"));
    expect(a).toBe(b);
  });

  it("a real component (MissionControlHistorySection, the sentence variant) hydrates across the boundary and ends with the right text", async () => {
    const tree = () => createElement(MissionControlHistorySection, { projectId: "p1", analysisRunId: null, lastReviewAt: "2026-10-13T10:17:00Z", isVerdictStale: false });
    const r = await serverThenHydrate(tree, "2026-10-14T06:16:58Z", "2026-10-14T06:17:04Z");
    expect(r.recoverable).toEqual([]);
    expect(r.consoleErrors).toEqual([]);
    expect(r.html).not.toMatch(/hace \d+ h/);
    expect(r.container.textContent).toContain("hace 20 h");
    expect(r.container.querySelector("[title='2026-10-13 10:17 UTC']")).not.toBeNull();
  });

  it("CONTROL (proves the test can fail): the old way, computing the relative text while rendering, DOES break hydration at the same boundary", async () => {
    const Old = () => createElement("p", null, formatRelativeLocalized("es", "2026-10-13T10:17:00Z", LABELS));
    const r = await serverThenHydrate(() => createElement(Old), "2026-10-14T06:16:58Z", "2026-10-14T06:17:04Z");
    expect(r.html).toContain("hace 19 h");
    expect(r.recoverable.length + r.consoleErrors.length).toBeGreaterThan(0);
  });
});

describe("after mount", () => {
  it("refreshes every minute and keeps the right value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T06:18:00Z"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => { root.render(label("2026-10-14T06:13:00Z")); });
    expect(container.querySelector("time")!.textContent).toBe("hace 5 min");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); // the fake clock moves with the timers: 06:19:00
    expect(container.querySelector("time")!.textContent).toBe("hace 6 min");
  });

  it("leaves no timer behind when it unmounts", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(label("2026-10-14T06:13:00Z")); });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await act(async () => { root.unmount(); });
    container.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an invalid instant never prints 'NaN'", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => { root.render(createElement(RelativeTimeLabel, { iso: "not-a-date", format: () => "hace NaN min" })); });
    expect(container.textContent).toBe("—");
  });
});

// @vitest-environment jsdom
import { createElement, act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/lib/i18n/client", () => ({ useI18n: (ns?: string) => ({ t: (key: string) => (ns ? key : key), locale: "es" }) }));

import { LocalTimeLabel } from "../local-time-label";
import { SecurityTimeline } from "@/components/sequrai/SecurityTimeline";
import { formatLocalizedDate } from "@/lib/i18n/format";

// Console of the 2026-10-14 acceptance on /mission-control, AFTER the relative-time fix: "Minified React error #418; args[]=text" on every
// load. The security timeline printed the hour with Intl in the runtime's zone: the server (UTC) said "10:17", the browser (Madrid) "12:17".
// These tests render on the "server" in one time zone and hydrate in another, with React itself.

const ORIGINAL_TZ = process.env.TZ;
const mounted: Array<{ root: Root; container: HTMLElement }> = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  vi.restoreAllMocks();
});

async function serverInZoneThenHydrateInZone(tree: () => ReturnType<typeof createElement>, serverZone: string, browserZone: string) {
  process.env.TZ = serverZone;
  const html = renderToString(tree());
  process.env.TZ = browserZone;
  const container = document.createElement("div");
  // The server HTML is adopted node by node (no markup assignment), as a browser does with the document it received.
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  container.append(...Array.from(parsed.body.childNodes));
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

const EVENTS = [
  { id: "a", at: "2026-10-13T09:12:00Z", label: "Completado" },
  { id: "b", at: "2026-10-13T10:17:00Z", label: "Repositorio analizado" },
];
const timeline = () => createElement(SecurityTimeline, { events: EVENTS });
const hm = (container: HTMLElement) => Array.from(container.querySelectorAll("time")).map((t) => t.textContent);

describe("the security timeline hydrates across time zones", () => {
  it("server in UTC, browser in Madrid: no hydration error; UTC first, the viewer's hour after mount; full instant in title", async () => {
    const r = await serverInZoneThenHydrateInZone(timeline, "UTC", "Europe/Madrid");
    expect(r.html).toContain("10:17 UTC");
    expect(r.html).not.toMatch(/>12:17</);
    expect(r.recoverable).toEqual([]);
    expect(r.consoleErrors).toEqual([]);
    expect(hm(r.container)).toEqual(["11:12", "12:17"]); // Madrid is UTC+2 in October
    expect(r.container.querySelector("time[title='2026-10-13 10:17 UTC']")).not.toBeNull();
    expect(r.container.querySelector("time")!.getAttribute("datetime")).toBe("2026-10-13T09:12:00.000Z");
  });

  it("the other direction (server in Madrid, browser in Los Angeles) is fine too", async () => {
    const r = await serverInZoneThenHydrateInZone(timeline, "Europe/Madrid", "America/Los_Angeles");
    expect(r.recoverable).toEqual([]);
    expect(r.consoleErrors).toEqual([]);
    expect(hm(r.container)).toEqual(["02:12", "03:17"]); // UTC-7
  });

  it("the server HTML does not depend on the server's zone", () => {
    process.env.TZ = "UTC";
    const a = renderToString(timeline());
    process.env.TZ = "Asia/Tokyo";
    const b = renderToString(timeline());
    expect(a).toBe(b);
  });

  it("CONTROL (proves the test can fail): the previous implementation, formatting the hour while rendering, DOES fail across zones", async () => {
    const Old = () =>
      createElement("p", null, new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date("2026-10-13T10:17:00Z")));
    const r = await serverInZoneThenHydrateInZone(() => createElement(Old), "UTC", "Europe/Madrid");
    expect(r.html).toContain("10:17");
    expect(r.recoverable.length + r.consoleErrors.length).toBeGreaterThan(0);
  });
});

describe("date-only labels near the UTC day boundary", () => {
  const iso = "2026-10-13T22:30:00Z"; // still the 13th in UTC, already the 14th in Madrid
  const tree = () => createElement(LocalTimeLabel, { iso, kind: "date", format: (d: Date) => formatLocalizedDate("es", d) });

  it("UTC date first, the viewer's date after mount, no error", async () => {
    const r = await serverInZoneThenHydrateInZone(tree, "UTC", "Europe/Madrid");
    expect(r.html).toContain("2026-10-13");
    expect(r.recoverable).toEqual([]);
    expect(r.consoleErrors).toEqual([]);
    expect(r.container.querySelector("time")!.textContent).toMatch(/14/);
    expect(r.container.querySelector("time")!.getAttribute("title")).toBe("2026-10-13 22:30 UTC");
  });

  it("CONTROL: formatting the date while rendering breaks at the boundary", async () => {
    const Old = () => createElement("p", null, formatLocalizedDate("es", iso));
    const r = await serverInZoneThenHydrateInZone(() => createElement(Old), "UTC", "Europe/Madrid");
    expect(r.recoverable.length + r.consoleErrors.length).toBeGreaterThan(0);
  });

  it("an invalid instant prints a dash, never 'Invalid Date'", async () => {
    const r = await serverInZoneThenHydrateInZone(() => createElement(LocalTimeLabel, { iso: "nope", kind: "datetime", format: () => "Invalid Date" }), "UTC", "UTC");
    expect(r.container.textContent).toBe("—");
  });
});

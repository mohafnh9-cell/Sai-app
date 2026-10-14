#!/usr/bin/env node
/**
 * Two real Chrome tabs sharing one session (one browser context, one cookie jar) against a local controlled server, driving the REAL
 * WorkspaceSwitcher component (bundled with esbuild; only i18n, supabase, next/link and the create dialog are stubbed).
 * No accounts, no credentials, no production access. The workspace lives in a cookie exactly as in the app, and the controlled server
 * records, for every "action", which workspace the cookie said and which workspace the tab was SHOWING.
 *
 *   node scripts/e2e-workspace-sync.mjs [--baseline=origin/main]    # also run the same scenarios against the previous component
 *
 * Exit 1 when a scenario fails for the current component. With --baseline the previous component is expected to FAIL the sync scenarios
 * (that is the reproduction); it never affects the exit code.
 * Limitation: headless Chrome does not fire focus/visibilitychange when a tab is brought to front, so the test dispatches those two events
 * (page.evaluate) after bringToFront(); the component's reaction to them is what is under test.
 */
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const COMP_DIR = path.join(ROOT, "features/workspaces/components");
const WS = [{ id: "a", name: "Workspace Alpha", plan: null, logoUrl: null }, { id: "b", name: "Workspace Beta", plan: null, logoUrl: null }];

function stubPlugin() {
  const stubs = {
    "@/lib/i18n/client": `export const useI18n = () => ({ t: (k) => k, locale: "en" });`,
    "@/features/demo/use-demo-navigation": `export const useDemoNavigation = () => ({ isDemo: false });`,
    "@/lib/supabase/client": `export const createClient = () => ({ auth: { signOut: async () => undefined } });`,
    "next/link": `import React from "react"; export default function Link({ href, children, ...r }) { return React.createElement("a", { href, ...r }, children); }`,
    "@/features/workspaces/components/CreateWorkspaceDialog": `export const CreateWorkspaceDialog = () => null;`,
  };
  return {
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined));
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: stubs[a.path], loader: "jsx", resolveDir: ROOT }));
    },
  };
}

async function bundle(componentFile) {
  const entry = path.join(COMP_DIR, ".e2e-entry.tsx");
  fs.writeFileSync(entry, `import React from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceSwitcher } from "./${path.basename(componentFile)}";
const init = window.__INIT;
createRoot(document.getElementById("root")).render(<WorkspaceSwitcher initialWorkspaces={init.workspaces} initialActiveWorkspaceId={init.active} />);
`);
  try {
    const out = await build({
      entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", target: "es2020",
      tsconfig: path.join(ROOT, "tsconfig.json"), plugins: [stubPlugin()], define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_WORKSPACE_DOCS_URL": '""', process: "{\"env\":{}}" }, logLevel: "error",
    });
    return out.outputFiles[0].text;
  } finally {
    fs.rmSync(entry, { force: true });
  }
}

function startServer(js) {
  const state = { stuck: null, actions: [], pageLoads: [] };
  const cookieOf = (req) => /(?:^|;\s*)ws=([ab])/.exec(req.headers.cookie ?? "")?.[1] ?? "a";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const active = cookieOf(req);
    const json = (code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...headers }); res.end(JSON.stringify(body)); };
    if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
    if (url.pathname === "/bundle.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(js); }
    if (url.pathname === "/dashboard") {
      // "stuck": the layout renders this workspace no matter what the cookie says (layout and API disagreeing)
      const shown = state.stuck ?? active;
      state.pageLoads.push({ tab: url.searchParams.get("tab"), shown });
      const name = WS.find((w) => w.id === shown).name;
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      return res.end(`<!doctype html><meta charset=utf-8><title>harness</title><body>
<div id="root"></div>
<main data-testid="content" data-ws="${shown}">Content of ${name}</main>
<input id="notes" type="text" aria-label="notes"><button id="act" type="button">Create project</button>
<script>window.__INIT=${JSON.stringify({ workspaces: WS, active: shown })};
document.getElementById("act").onclick=()=>{const shownNow=document.querySelector('[data-testid=content]').dataset.ws;
 const label=document.querySelector('button[aria-haspopup=menu]').getAttribute('aria-label');
 fetch("/api/action",{method:"POST",headers:{"x-shown-selector":label,"x-shown-content":shownNow}});};</script>
<script src="/bundle.js"></script>`);
    }
    if (url.pathname === "/api/workspaces" && req.method === "GET") return json(200, { workspaces: WS, activeWorkspaceId: active });
    if (url.pathname === "/api/workspaces/switch" && req.method === "POST") {
      let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { const id = JSON.parse(body).workspaceId; json(200, { ok: true }, { "set-cookie": `ws=${id}; Path=/` }); });
      return;
    }
    if (url.pathname === "/api/action" && req.method === "POST") {
      state.actions.push({ cookie: active, selector: req.headers["x-shown-selector"], content: req.headers["x-shown-content"] });
      return json(200, { ok: true });
    }
    if (url.pathname === "/__set" && req.method === "POST") { state.stuck = url.searchParams.get("stuck") || null; return json(200, {}); }
    json(404, {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}

const NAME = { a: "Workspace Alpha", b: "Workspace Beta" };
const sync = async (page) => {
  await page.bringToFront();
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(700);
};
const shown = async (page) => ({
  selector: await page.locator("button[aria-haspopup=menu]").getAttribute("aria-label"),
  content: await page.locator("[data-testid=content]").getAttribute("data-ws"),
});

async function run(label, componentFile) {
  const js = await bundle(componentFile);
  const { server, state, base } = await startServer(js);
  const browser = await chromium.launch({ channel: "chrome" });
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` -- ${detail}` : ""}`); };
  try {
    const ctx = await browser.newContext(); // one cookie jar: the two tabs share the session
    const t1 = await ctx.newPage(); const t2 = await ctx.newPage();
    for (const pg of [t1, t2]) { pg.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200))); pg.on("console", (m) => m.type() === "error" && console.log("  [console.error]", m.text().slice(0, 200))); }
    const loads = { t1: 0, t2: 0 };
    t1.on("load", () => loads.t1++); t2.on("load", () => loads.t2++);
    await t1.goto(`${base}/dashboard?tab=1`); await t2.goto(`${base}/dashboard?tab=2`);
    let s1 = await shown(t1);
    check("both tabs start on Alpha (selector and content)", s1.selector === NAME.a && s1.content === "a" && (await shown(t2)).content === "a");

    // tab 2 switches through the real menu; the real component POSTs and navigates
    await t2.bringToFront();
    await t2.locator("button[aria-haspopup=menu]").click();
    await t2.getByRole("button", { name: /Workspace Beta/ }).last().click();
    await t2.waitForLoadState("load"); await t2.waitForSelector("[data-testid=content][data-ws=b]");
    check("tab 2 switched to Beta through the UI", (await shown(t2)).selector === NAME.b);

    // tab 1 comes back to the foreground
    const before = loads.t1;
    await sync(t1);
    s1 = await shown(t1);
    const reloads = loads.t1 - before;
    check("tab 1 selector and content both show Beta after returning", s1.selector === NAME.b && s1.content === "b", `selector=${s1.selector} content=${s1.content}`);
    check("tab 1 reloaded exactly once", reloads === 1, `reloads=${reloads}`);

    // action from tab 1: the workspace the tab shows must be the one the cookie (server) acts on
    state.actions.length = 0;
    await t1.click("#act");
    await t1.waitForTimeout(300);
    const act = state.actions[0];
    check("action from tab 1 acts on the workspace it shows", act && act.cookie === "b" && act.selector === NAME.b && act.content === "b", JSON.stringify(act));

    // typing protection: tab 2 goes back to Alpha while tab 1 has text in a field
    await t2.bringToFront();
    await t2.locator("button[aria-haspopup=menu]").click();
    await t2.getByRole("button", { name: /Workspace Alpha/ }).last().click();
    await t2.waitForSelector("[data-testid=content][data-ws=a]");
    await t1.bringToFront();
    await t1.fill("#notes", "unsaved text"); await t1.focus("#notes");
    const beforeTyping = loads.t1;
    await sync(t1);
    check("no reload while the person has typed text in a focused field", loads.t1 === beforeTyping && (await t1.inputValue("#notes")) === "unsaved text", `reloads=${loads.t1 - beforeTyping}`);
    await t1.fill("#notes", "");
    await sync(t1);
    s1 = await shown(t1);
    check("once the field is empty the tab realigns with Alpha (one reload)", loads.t1 - beforeTyping === 1 && s1.selector === NAME.a && s1.content === "a", `reloads=${loads.t1 - beforeTyping} selector=${s1.selector}`);

    // reload limit, on a fresh session (the per-target limit is kept in sessionStorage): the cookie says Beta, the layout keeps rendering Alpha
    await fetch(`${base}/__set?stuck=a`, { method: "POST" });
    const ctx2 = await browser.newContext();
    await ctx2.addCookies([{ name: "ws", value: "b", url: base }]);
    const t3 = await ctx2.newPage(); let loads3 = 0; t3.on("load", () => loads3++);
    await t3.goto(`${base}/dashboard?tab=3`);
    const base3 = loads3;
    for (let i = 0; i < 6; i++) await sync(t3);
    check("permanent disagreement: exactly one reload in six returns to the tab (no loop)", loads3 - base3 === 1, `reloads=${loads3 - base3}`);
  } finally {
    await browser.close(); server.close();
  }
  return results;
}

console.log("== current component");
const current = await run("current", path.join(COMP_DIR, "WorkspaceSwitcher.tsx"));
let failed = current.some((r) => !r.ok);
if (args.baseline) {
  const old = path.join(COMP_DIR, ".WorkspaceSwitcher.baseline.tsx");
  fs.writeFileSync(old, execFileSync("git", ["show", `${args.baseline}:features/workspaces/components/WorkspaceSwitcher.tsx`], { cwd: ROOT, encoding: "utf8" }));
  try {
    console.log(`== baseline (${args.baseline}) -- failures here are the reproduction of the defect`);
    await run("baseline", old);
  } finally { fs.rmSync(old, { force: true }); }
}
process.exit(failed ? 1 : 0);

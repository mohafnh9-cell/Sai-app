#!/usr/bin/env node
/**
 * Two real Chrome tabs sharing one session (one browser context, one cookie jar) against a local controlled server, driving the REAL
 * WorkspaceSwitcher + WorkspaceContextProvider (fetch guard, notice) bundled with esbuild (only i18n, supabase, next/link and the create
 * dialog are stubbed). The server side of the write is the REAL server/workspaces/explicit-context.ts (bundled for node; only its
 * membership lookup is stubbed). No accounts, no credentials, no production access. The workspace lives in a cookie exactly as in the
 * app; the controlled endpoint (/api/mcp/keys) records which workspace each accepted write was ASSOCIATED with, and rejections write nothing.
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
import { fileURLToPath, pathToFileURL } from "node:url";
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

async function bundle(componentFile, withProvider) {
  const entry = path.join(COMP_DIR, ".e2e-entry.tsx");
  fs.writeFileSync(entry, `import React from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceSwitcher } from "./${path.basename(componentFile)}";
${withProvider ? 'import { WorkspaceContextProvider } from "@/lib/workspaces/workspace-context";' : ""}
const init = window.__INIT;
const switcher = <WorkspaceSwitcher initialWorkspaces={init.workspaces} initialActiveWorkspaceId={init.active} />;
createRoot(document.getElementById("root")).render(${withProvider ? "<WorkspaceContextProvider workspaceId={init.active}>{switcher}</WorkspaceContextProvider>" : "switcher"});
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

async function buildServerGuard() {
  // the REAL server rule, bundled for node (only the membership lookup and the server-only marker are stubbed)
  const out = path.join(ROOT, "scripts", ".e2e-guard.mjs");
  const stub = {
    name: "server-stubs",
    setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "srv" }));
      b.onResolve({ filter: /^@\/server\/workspaces\/service$/ }, () => ({ path: "service", namespace: "srv" }));
      b.onResolve({ filter: /^next\/server$/ }, () => ({ path: "next-server", namespace: "srv" }));
      b.onLoad({ filter: /.*/, namespace: "srv" }, (a) => ({
        contents: a.path === "server-only" ? "" : a.path === "next-server"
          ? "export const NextResponse = { json: (b, init = {}) => new Response(JSON.stringify(b), { status: init.status ?? 200, headers: { 'content-type': 'application/json' } }) };"
          : "export const assertWorkspaceMembership = async (_s, _u, ws) => globalThis.__members.has(ws);",
        loader: "js",
      }));
    },
  };
  await build({
    stdin: { contents: `export { requireExplicitWorkspace } from "@/server/workspaces/explicit-context";`, resolveDir: ROOT, loader: "ts" },
    bundle: true, format: "esm", platform: "node", outfile: out, tsconfig: path.join(ROOT, "tsconfig.json"), plugins: [stub], logLevel: "error",
  });
  return out;
}

function startServer(js, guard) {
  // guard=null -> the previous server behaviour: any write goes to the workspace in the cookie, nothing is checked
  const state = { writes: [], requests: 0 };
  globalThis.__members = new Set(["a", "b"]);
  const cookieOf = (req) => /(?:^|;\s*)ws=([ab])/.exec(req.headers.cookie ?? "")?.[1] ?? "a";
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const active = cookieOf(req);
    const json = (code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...headers }); res.end(JSON.stringify(body)); };
    if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
    if (url.pathname === "/bundle.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(js); }
    if (url.pathname === "/dashboard") {
      const shown = state.stuck ?? active;
      const name = WS.find((w) => w.id === shown).name;
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      return res.end(`<!doctype html><meta charset=utf-8><title>harness</title><body>
<div id="root"></div>
<main data-testid="content" data-ws="${shown}">Content of ${name}</main>
<input id="notes" type="text" aria-label="notes"><button id="act" type="button">Create key</button>
<script>window.__INIT=${JSON.stringify({ workspaces: WS, active: shown })};
window.__results=[];
document.getElementById("act").onclick=async()=>{const r=await fetch("/api/mcp/keys"+(window.__delay?"?delay="+window.__delay:""),{method:"POST",headers:{"content-type":"application/json"},body:"{}"});window.__results.push({status:r.status,body:await r.json().catch(()=>null)});};</script>
<script src="/bundle.js"></script>`);
    }
    if (url.pathname === "/api/workspaces" && req.method === "GET") return json(200, { workspaces: WS, activeWorkspaceId: active });
    if (url.pathname === "/api/workspaces/switch" && req.method === "POST") {
      let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => json(200, { ok: true }, { "set-cookie": `ws=${JSON.parse(body).workspaceId}; Path=/` }));
      return;
    }
    if (url.pathname === "/api/mcp/keys" && req.method === "POST") {
      state.requests++;
      const delay = Number(url.searchParams.get("delay") ?? 0);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (!guard) { state.writes.push({ org: active, shown: req.headers["x-sequrai-workspace-id"] ?? null }); return json(200, { ok: true }); }
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const result = await guard.requireExplicitWorkspace(new Request(`http://x${req.url}`, { method: "POST", headers }), {}, "u1", active);
      if (!result.ok) {
        const body = await result.response.json();
        return json(result.response.status, body);
      }
      state.writes.push({ org: result.organizationId, shown: req.headers["x-sequrai-workspace-id"] });
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
const switchTo = async (page, id) => {
  await page.bringToFront();
  await page.locator("button[aria-haspopup=menu]").click();
  await page.getByRole("button", { name: new RegExp(NAME[id]) }).last().click();
  await page.waitForSelector(`[data-testid=content][data-ws=${id}]`);
};
const act = async (page, state) => {
  const before = state.writes.length; const results0 = await page.evaluate(() => window.__results.length);
  await page.click("#act");
  await page.waitForFunction((n) => window.__results.length > n, results0, { timeout: 5000 }).catch(() => undefined);
  return { wrote: state.writes.slice(before), result: (await page.evaluate(() => window.__results)).slice(results0)[0] ?? null };
};
const noticeVisible = (page) => page.locator("[data-testid=workspace-context-notice]").count().then((n) => n > 0);

async function run(label, componentFile, { withProvider, guardFile }) {
  const js = await bundle(componentFile, withProvider);
  const guard = guardFile ? await import(`${guardFile}?t=${Date.now()}`) : null;
  const { server, state, base } = await startServer(js, guard);
  const browser = await chromium.launch({ channel: "chrome" });
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` -- ${detail}` : ""}`); };
  try {
    const ctx = await browser.newContext(); // one cookie jar: the two tabs share the session
    const t1 = await ctx.newPage(); const t2 = await ctx.newPage();
    for (const pg of [t1, t2]) pg.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
    const loads = { t1: 0 }; t1.on("load", () => loads.t1++);
    await t1.goto(`${base}/dashboard?tab=1`); await t2.goto(`${base}/dashboard?tab=2`);
    check("both tabs start on Alpha", (await shown(t1)).selector === NAME.a && (await shown(t2)).content === "a");

    // 1. another tab switches while this one has nothing typed
    await switchTo(t2, "b");
    const before = loads.t1;
    await sync(t1);
    let s1 = await shown(t1);
    check("[no typing] returning to the stale tab realigns selector and content (Beta/Beta) with one reload", s1.selector === NAME.b && s1.content === "b" && loads.t1 - before === 1, `selector=${s1.selector} content=${s1.content} reloads=${loads.t1 - before}`);
    let r = await act(t1, state);
    check("[no typing] the write is associated with the workspace shown (Beta)", r.wrote.length === 1 && r.wrote[0].org === "b" && s1.selector === NAME.b && r.result?.status === 200, `written to ${r.wrote[0]?.org}, tab shows ${s1.selector}`);

    // 2. another tab switches while this one has an open form with text
    await switchTo(t2, "a");
    await t1.bringToFront(); await t1.fill("#notes", "unsaved text"); await t1.focus("#notes");
    const beforeTyping = loads.t1; const writes0 = state.writes.length; const requests0 = state.requests;
    await sync(t1);
    check("[typing] no reload and the text is preserved", loads.t1 === beforeTyping && (await t1.inputValue("#notes")) === "unsaved text", `reloads=${loads.t1 - beforeTyping}`);
    check("[typing] an explicit notice (role=alert) is shown", await noticeVisible(t1));
    r = await act(t1, state);
    check("[typing] the affected action is blocked: nothing reaches the server and nothing is written", state.requests === requests0 && state.writes.length === writes0 && r.result?.status === 409 && r.result?.body?.code === "workspace_context_blocked", `serverRequests=${state.requests - requests0} result=${JSON.stringify(r.result)}`);

    // 3. the server rejects on its own, even if a client skips the guard (old build, other client): raw XHR with the stale header
    const raw = await t1.evaluate(() => new Promise((resolve) => {
      const x = new XMLHttpRequest(); x.open("POST", "/api/mcp/keys"); x.setRequestHeader("x-sequrai-workspace-id", "b"); // stale: the cookie says Alpha now
      x.onload = () => resolve({ status: x.status, body: JSON.parse(x.responseText), location: x.getResponseHeader("location") }); x.send("{}");
    }));
    check("[server] stale stated workspace with cookie on another one: 409, no redirect, nothing written", raw.status === 409 && raw.body.code === "workspace_context_mismatch" && raw.location === null && state.writes.length === writes0, JSON.stringify(raw.body));
    const missing = await t1.evaluate(() => fetch("/api/mcp/keys", { method: "POST" }).then(() => null).catch(() => null)); void missing;

    // 4. reconcile through the notice
    const beforeReconcile = loads.t1;
    const reloadButton = t1.getByRole("button", { name: /contextChanged\.reload/ });
    if (await reloadButton.count()) await reloadButton.click(); else await t1.reload(); // no notice to click in the previous build
    await t1.waitForLoadState("load"); await t1.waitForTimeout(300);
    s1 = await shown(t1);
    check("[reconcile] Reload realigns the tab (Alpha/Alpha) and the notice disappears", loads.t1 - beforeReconcile === 1 && s1.selector === NAME.a && s1.content === "a" && !(await noticeVisible(t1)), `selector=${s1.selector}`);
    r = await act(t1, state);
    check("[reconcile] the next write goes to the workspace shown (Alpha)", r.wrote.length === 1 && r.wrote[0].org === "a" && r.result?.status === 200, JSON.stringify(r.wrote));

    // 5. request in flight while the other tab switches
    await t1.bringToFront();
    await t1.evaluate(() => { window.__delay = 900; });
    const inflightBase = state.writes.length;
    await t1.click("#act"); // sent now with Alpha, answered after 900 ms
    await switchTo(t2, "b");
    await t1.waitForFunction(() => window.__results.length >= 3, null, { timeout: 5000 }).catch(() => undefined);
    const landed = state.writes.slice(inflightBase);
    check("[in flight] a request sent from Alpha before the switch is never written to Beta", landed.every((w) => w.org === "a") && !state.writes.slice(inflightBase).some((w) => w.org === "b"), JSON.stringify(landed));
    await t1.evaluate(() => { window.__delay = 0; });

    // 6. the reload limit: the layout keeps rendering Alpha although the cookie says Beta, on a fresh session
    state.stuck = "a";
    const ctx2 = await browser.newContext();
    await ctx2.addCookies([{ name: "ws", value: "b", url: base }]);
    const t3 = await ctx2.newPage(); let loads3 = 0; t3.on("load", () => loads3++);
    await t3.goto(`${base}/dashboard?tab=3`);
    const base3 = loads3;
    for (let i = 0; i < 6; i++) await sync(t3);
    check("[limit] permanent disagreement: exactly one reload in six returns, then the notice (no loop)", loads3 - base3 === 1 && (await noticeVisible(t3)), `reloads=${loads3 - base3} notice=${await noticeVisible(t3)}`);
    r = await act(t3, state);
    check("[limit] the write from that tab is blocked", r.wrote.length === 0 && r.result?.status === 409, JSON.stringify(r.result));
  } finally {
    await browser.close(); server.close();
  }
  return results;
}

const guardFile = await buildServerGuard();
console.log("== current component + provider + real server rule");
let current;
try {
  current = await run("current", path.join(COMP_DIR, "WorkspaceSwitcher.tsx"), { withProvider: true, guardFile: pathToFileURL(guardFile).href });
} finally { fs.rmSync(guardFile, { force: true }); }
const failed = current.some((r) => !r.ok);
if (args.baseline) {
  const old = path.join(COMP_DIR, ".WorkspaceSwitcher.baseline.tsx");
  fs.writeFileSync(old, execFileSync("git", ["show", `${args.baseline}:features/workspaces/components/WorkspaceSwitcher.tsx`], { cwd: ROOT, encoding: "utf8" }));
  try {
    console.log(`== baseline (${args.baseline}: previous component, no provider, server writes to whatever the cookie says) -- failures here are the reproduction`);
    await run("baseline", old, { withProvider: false, guardFile: null });
  } finally { fs.rmSync(old, { force: true }); }
}
process.exit(failed ? 1 : 0);

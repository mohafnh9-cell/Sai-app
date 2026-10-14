#!/usr/bin/env node
/**
 * Full-page hydration matrix (real Next server + real Chrome, no mocks of React).
 *
 * For every combination of  SERVER time zone x BROWSER time zone x BROWSER locale x page  it loads the page and records everything the
 * browser reports: `pageerror`, console errors/warnings, failed document requests. A hydration problem is recognised by what React itself
 * says (dev: "Hydration failed ... didn't match", with the diff; production: "Minified React error #418/#423/#425"), never by guessing.
 *
 * It uses only the public /demo pages (server-rendered with fixtures, same client components as the authenticated pages) and the public
 * auth/legal pages, so it needs no credentials and writes nothing. Google Chrome is launched through Playwright's `chrome` channel (no
 * browser download); it is a fresh profile: no extensions.
 *
 *   node scripts/e2e-hydration.mjs --mode=dev|start [--server-tz=UTC,Asia/Tokyo] [--browser-tz=...] [--locales=es-ES,en-US]
 *                                   [--pages=...] [--port=3301] [--report=hydration-report.json] [--concurrency=3]
 * `--mode=start` expects a production build (`next build`). Exit code 1 when any hydration error is found.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "true"]));
const MODE = args.mode === "start" ? "start" : "dev";
const PORT = Number(args.port ?? 3301);
const BASE = `http://localhost:${PORT}`;
const list = (value, fallback) => (value ? String(value).split(",").filter(Boolean) : fallback);
const SERVER_ZONES = list(args["server-tz"], ["UTC", "Asia/Tokyo"]);
const BROWSER_ZONES = list(args["browser-tz"], ["Europe/Madrid", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Auckland", "UTC"]);
const LOCALES = list(args.locales, ["es-ES", "en-US"]);
const ACME = "a1111111-1111-4111-8111-111111111111";
const SCAN = "a3333333-3333-4333-8333-333333333333";
const PAGES = list(args.pages, [
  "/", "/login", "/signup", "/privacy", "/terms",
  "/demo", "/demo/dashboard", "/demo/projects", `/demo/projects/${ACME}`, `/demo/projects/${ACME}/journey`, `/demo/projects/${ACME}/scans/${SCAN}`,
  "/demo/integrations", "/demo/settings",
  `/demo/projects/${ACME}?scenario=not-ready`, `/demo/projects/${ACME}?scenario=first-verdict`, `/demo/projects/${ACME}/journey?scenario=not-ready`,
  `/demo/projects/${ACME}?scenario=review-in-progress`,
]);
const CONCURRENCY = Number(args.concurrency ?? 3);

const HYDRATION = /hydrat|did not match|didn't match|Minified React error #(418|423|425|419|422|421)|text content does not match/i;
const NOISE = /_vercel\/insights|favicon|ERR_BLOCKED_BY_CLIENT|Download the React DevTools|\[Fast Refresh\]|webpack-hmr|Permissions-Policy/i;

function startServer(serverTz) {
  const env = {
    ...process.env,
    TZ: serverTz,
    NODE_ENV: MODE === "dev" ? "development" : "production",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "dummy",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "dummy",
    NEXT_PUBLIC_APP_URL: BASE,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const child = spawn("npx", ["next", MODE, "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, log: () => log };
}

async function waitReady(server) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server did not become ready:\n${server.log().slice(-1500)}`);
}

function stop(server) {
  try { process.kill(-server.child.pid, "SIGTERM"); } catch { /* already gone */ }
}

async function loadPage(browser, { serverTz, browserTz, locale, path }) {
  const context = await browser.newContext({ locale, timezoneId: browserTz, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const hydration = [];
  const other = [];
  const record = (kind, text, url) => {
    if (NOISE.test(text) || NOISE.test(url ?? "")) return;
    (HYDRATION.test(text) ? hydration : other).push(`${kind}: ${text.slice(0, 8000)}`);
  };
  page.on("pageerror", (e) => record("pageerror", String(e?.message ?? e)));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") record(`console.${m.type()}`, m.text(), m.location()?.url); });
  let status = null;
  try {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60000 });
    status = response?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1200); // hydration and the first post-mount update
  } catch (error) {
    other.push(`navigation: ${String(error?.message ?? error).slice(0, 300)}`);
  }
  const shownTimes = await page.evaluate(() => Array.from(document.querySelectorAll("time")).slice(0, 3).map((t) => t.textContent)).catch(() => []);
  await context.close();
  return { serverTz, browserTz, locale, path, status, hydration, other, shownTimes };
}

async function pool(items, size, worker) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const item = items[next++];
      results.push(await worker(item));
    }
  }));
  return results;
}

const results = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
console.log(`mode=${MODE} chrome=${browser.version()} server zones=${SERVER_ZONES} browser zones=${BROWSER_ZONES} locales=${LOCALES} pages=${PAGES.length}`);
try {
  for (const serverTz of SERVER_ZONES) {
    const server = startServer(serverTz);
    try {
      await waitReady(server);
      // warm up each page once (dev compiles on demand; the first load is slow and must not count as a timing artefact)
      for (const path of PAGES) await fetch(`${BASE}${path}`).catch(() => undefined);
      const jobs = [];
      for (const browserTz of BROWSER_ZONES) for (const locale of LOCALES) for (const path of PAGES) jobs.push({ serverTz, browserTz, locale, path });
      results.push(...(await pool(jobs, CONCURRENCY, (job) => loadPage(browser, job))));
      console.log(`server TZ=${serverTz}: ${jobs.length} page loads done`);
    } finally {
      stop(server);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
} finally {
  await browser.close();
}

const bad = results.filter((r) => r.hydration.length > 0);
const failedStatus = results.filter((r) => r.status === null || r.status >= 500);
const byPage = new Map();
for (const r of bad) {
  const entry = byPage.get(r.path) ?? { combos: new Set(), messages: new Set() };
  entry.combos.add(`${r.serverTz}->${r.browserTz}/${r.locale}`);
  r.hydration.forEach((m) => entry.messages.add(m.slice(0, 400)));
  byPage.set(r.path, entry);
}
console.log(`\nloads: ${results.length}  with hydration errors: ${bad.length}  with HTTP 5xx/none: ${failedStatus.length}`);
for (const [path, e] of byPage) {
  console.log(`\nHYDRATION  ${path}  (${e.combos.size} combinations)`);
  for (const m of e.messages) console.log(`   ${m.replace(/\n/g, " ⏎ ").slice(0, 380)}`);
  console.log(`   e.g. ${[...e.combos].slice(0, 4).join(" | ")}`);
}
for (const r of failedStatus) console.log(`STATUS ${r.status} ${r.path} (${r.serverTz}->${r.browserTz}/${r.locale})`);
const otherErrors = new Map();
for (const r of results) for (const m of r.other) otherErrors.set(m.slice(0, 160), (otherErrors.get(m.slice(0, 160)) ?? 0) + 1);
if (otherErrors.size) { console.log("\nnon-hydration console/page errors:"); for (const [m, n] of otherErrors) console.log(`  x${n}  ${m}`); }
if (args.report) writeFileSync(args.report, JSON.stringify({ mode: MODE, results }, null, 1));
process.exit(bad.length > 0 || failedStatus.length > 0 ? 1 : 0);

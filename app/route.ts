import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 42.5 (public landing migration): `/` is served as a raw Route
 * Handler response, not a React page. The new landing
 * (content/landing/index.html) is a self-contained, self-unpacking static
 * bundle -- it ships its own <html>/<head>/<body> and a bootstrapping
 * script that inflates its own fonts/images/markup client-side. Rendering
 * it through the app's React tree (app/layout.tsx) would double-wrap the
 * document and risks hydration/CSP interference with that bootstrap
 * script; a Route Handler bypasses layouts entirely (Next.js: route.ts
 * "does not participate in layouts"), so the file is returned byte-for-byte,
 * exactly as it already runs standalone at sequrai-landing-oficial.
 */
export const dynamic = "force-static";

const NEW_LANDING_HTML = readFileSync(
  path.join(process.cwd(), "content/landing/index.html"),
  "utf-8"
);

export async function GET() {
  return new Response(NEW_LANDING_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

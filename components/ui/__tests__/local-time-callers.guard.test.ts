import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A client component that is also rendered on the server must not print dates or times in the runtime's time zone/locale while rendering:
// the server (UTC) and the browser disagree and React reports error #418 (text). They go through <LocalTimeLabel> / <RelativeTimeLabel>,
// or through the UTC helpers in lib/format/stable-date.
const PATTERN = /Intl\.DateTimeFormat\(|\bformatLocalizedDate\(|\bformatScanDate\(|[^A-Za-z]formatDate\(|toLocale(?:Date|Time)?String\(|\.getHours\(|\.getMinutes\(/;
// Reviewed exceptions, each with the reason it cannot take part in hydration.
const ALLOWED: Record<string, string> = {
  "features/production-journey/components/JourneyScoreChart.tsx": "chart tooltip: only rendered after the pointer moves over the chart (client-only state)",
  "features/assisted-fix/components/AssistedFixPanel.tsx": "formatDate is an alias of formatStableDateTime (UTC, deterministic)",
  "features/settings/McpApiKeysPanel.tsx": "the keys arrive from a fetch inside useEffect: never part of the server HTML, nothing to hydrate against",
};

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) yield path;
  }
}
const clientFiles = ["app", "components", "features"]
  .flatMap((root) => Array.from(sources(root)))
  .filter((file) => /^["']use client["']/m.test(readFileSync(file, "utf8").split("\n").slice(0, 3).join("\n")));

describe("client components print no date or time in the runtime's zone while rendering", () => {
  it("(the guard is not vacuous: it looks at many client components)", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
  });

  it.each(clientFiles.filter((f) => PATTERN.test(readFileSync(f, "utf8"))))("%s", (file) => {
    if (ALLOWED[file]) return;
    const text = readFileSync(file, "utf8");
    expect(text.includes("LocalTimeLabel") || text.includes("RelativeTimeLabel")).toBe(true);
  });

  it("every exception is still needed (an allowed file that no longer matches must be removed from the list)", () => {
    for (const file of Object.keys(ALLOWED)) expect(PATTERN.test(readFileSync(file, "utf8"))).toBe(true);
  });
});

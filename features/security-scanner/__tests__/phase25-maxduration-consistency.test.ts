import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 25 -- regression test for the real maxDuration inconsistency found
 * this phase: vercel.json declared 60s for the scan-trigger route while the
 * route file itself exported maxDuration=300, and Next.js's route segment
 * config silently wins over vercel.json's `functions` map wherever both
 * exist for the same route -- meaning the deployed function very likely
 * ran with 300s despite vercel.json's contrary-looking declaration.
 *
 * This test parses vercel.json's `functions` map and cross-checks every
 * entry against that route file's own `export const maxDuration` (when one
 * exists), failing if they ever silently diverge again. Routes with no
 * route-level export are unaffected (vercel.json is authoritative for
 * those) and are skipped.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../");

function vercelJsonPathToGlobRegex(vercelPath: string): RegExp {
  // vercel.json uses glob-like patterns (`**`) for dynamic segments --
  // convert to a regex that matches the real file paths under app/api.
  const escaped = vercelPath
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRouteFiles(full));
    } else if (entry.name === "route.ts") {
      results.push(full);
    }
  }
  return results;
}

function extractMaxDuration(fileContent: string): number | null {
  const match = /export\s+const\s+maxDuration\s*=\s*(\d+)/.exec(fileContent);
  return match ? Number(match[1]) : null;
}

describe("Phase 25 -- vercel.json maxDuration stays consistent with route-level exports", () => {
  const vercelJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "vercel.json"), "utf-8")) as {
    functions?: Record<string, { maxDuration?: number }>;
  };

  it("vercel.json declares at least the routes we expect (sanity check the fixture itself loaded)", () => {
    expect(Object.keys(vercelJson.functions ?? {}).length).toBeGreaterThan(0);
  });

  const allRouteFiles = findRouteFiles(path.join(REPO_ROOT, "app", "api"));

  for (const [vercelPath, config] of Object.entries(vercelJson.functions ?? {})) {
    if (typeof config.maxDuration !== "number") continue;
    const pattern = vercelJsonPathToGlobRegex(vercelPath);
    const matchingFiles = allRouteFiles.filter((f) => pattern.test(path.relative(REPO_ROOT, f)));

    it(`${vercelPath} (vercel.json maxDuration=${config.maxDuration}): every matching route file agrees or has no override`, () => {
      expect(matchingFiles.length).toBeGreaterThan(0);
      for (const file of matchingFiles) {
        const content = fs.readFileSync(file, "utf-8");
        const routeLevel = extractMaxDuration(content);
        if (routeLevel === null) continue; // vercel.json is authoritative here, nothing to conflict with
        expect(
          routeLevel,
          `${file} exports maxDuration=${routeLevel} but vercel.json declares ${config.maxDuration} for ${vercelPath} -- ` +
            `Next.js's route-level export wins, so vercel.json's value is misleading dead configuration. Keep them in sync.`
        ).toBe(config.maxDuration);
      }
    });
  }
});

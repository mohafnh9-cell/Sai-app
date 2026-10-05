import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 8I.1 regression guard. A dynamic verdict-status translation key
 * (`status.${status}.label|headline|message|description`) maps `ready_to_ship`
 * straight to affirmative deployment copy. Only the gated helpers may build such a key:
 *  - lib/i18n/verdict-copy.ts (verdictCopyKey: ready_to_ship needs `affirms === true`)
 *  - lib/i18n/analysis-run-status.ts (delegates to verdictCopyKey)
 *  - ReadyToShipMoment.tsx (rendered only when the canonical gate set showReadyMoment)
 * Anything else must go through verdictStatusLabel/Headline/Message/Description.
 */
const ALLOWED = new Set([
  "lib/i18n/verdict-copy.ts",
  "lib/i18n/analysis-run-status.ts",
  "features/production-verdict/components/ReadyToShipMoment.tsx",
]);
const ROOTS = ["app", "features", "components", "lib", "server", "brain"];
const DYNAMIC_VERDICT_KEY = /status\.\$\{[^}]*\}\.(label|headline|message|description)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("no ungated dynamic verdict-status copy keys", () => {
  it("only the gated helpers build status.${status}.<copy> keys", () => {
    const offenders = ROOTS.flatMap((root) => walk(root))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => DYNAMIC_VERDICT_KEY.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the allow-listed helpers really are gated (verdictCopyKey is referenced)", () => {
    expect(readFileSync("lib/i18n/verdict-copy.ts", "utf8")).toMatch(/affirms !== true/);
    expect(readFileSync("lib/i18n/analysis-run-status.ts", "utf8")).toMatch(/verdictCopyKey/);
  });
});

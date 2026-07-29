import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanRepository } from "../index";

const CODE_EXT = /\.(?:[cm]?tsx?|jsx)$/i;
const SKIP_DIR = /(?:^|\/)(?:node_modules|\.next|dist|coverage|\.git)(?:\/|$)/;
const TEST_FILE = /(?:^|\/)(?:__tests__|tests?)(?:\/|$)|\.(?:test|spec)\./i;

function collectCodeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (SKIP_DIR.test(full) || TEST_FILE.test(full)) continue;
    if (statSync(full).isDirectory()) collectCodeFiles(full, acc);
    else if (CODE_EXT.test(entry)) acc.push(full);
  }
  return acc;
}

describe("repository auth audit", () => {
  it("has no auth.missing / authz.insufficient on API routes", async () => {
    const root = join(process.cwd(), "app/api");
    const paths = collectCodeFiles(root).filter((p) => p.endsWith("route.ts"));
    const files = paths.map((path) => ({
      path: path.replace(`${process.cwd()}/`, ""),
      content: readFileSync(path, "utf8"),
    }));
    const result = await scanRepository(files);
    const bad = result.findings.filter(
      (f) => f.ruleId === "auth.missing" || f.ruleId === "authz.insufficient"
    );
    expect(bad).toEqual([]);
  });

  it("lists authentication-category findings including tests (production snapshot)", async () => {
    const paths: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (SKIP_DIR.test(full)) continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (CODE_EXT.test(entry)) paths.push(full);
      }
    }
    walk(process.cwd());
    const files = paths.map((path) => ({
      path: path.replace(`${process.cwd()}/`, ""),
      content: readFileSync(path, "utf8"),
    }));
    const result = await scanRepository(files);
    const authRelated = result.findings.filter((f) => f.category === "authentication");
    if (authRelated.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        authRelated
          .map((f) => `${f.ruleId}\t${f.location.path}:${f.location.line ?? 1}\t${f.title}`)
          .join("\n")
      );
    }
    expect(authRelated.length).toBeLessThanOrEqual(0);
  });
});

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CORE_ROOT = join(__dirname, "..");

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      files.push(...listTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("RT-Core dependency rules", () => {
  it("core must not import domain teams", () => {
    const forbidden = [/business-logic/, /llm-team/, /\/teams\//];
    const violations: string[] = [];
    for (const file of listTsFiles(CORE_ROOT)) {
      const content = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(content) && content.includes("from ")) {
          const lines = content.split("\n").filter((l) => l.includes("from ") && pattern.test(l));
          if (lines.length > 0) violations.push(`${file}: ${lines.join(" | ")}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

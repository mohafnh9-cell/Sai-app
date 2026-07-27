import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CORE_ROOT = join(__dirname, "../../core");

describe("Threat model dependency rules", () => {
  it("RT-Core must not import threat-model", () => {
    const violations: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__") continue;
          walk(full);
        } else if (entry.name.endsWith(".ts")) {
          const content = readFileSync(full, "utf8");
          if (/threat-model/.test(content) && content.includes("from ")) {
            violations.push(full);
          }
        }
      }
    }
    walk(CORE_ROOT);
    expect(violations).toEqual([]);
  });
});

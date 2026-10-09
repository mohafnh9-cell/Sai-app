import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLocalProductionVerdict } from "../run-local-verdict";

/**
 * KNOWN GAP (pilot, 2026-10): the native `injection.sql` rule
 * (features/security-scanner/rules/builtin.ts) matches `query|execute|raw("<literal without quotes>" + ...)`.
 * Its literal is `["'][^"']*["']`, which STOPS at a quote of the other kind. The most common hand-written form,
 *     db.query("SELECT * FROM orders WHERE id = '" + id + "'")
 * embeds single quotes inside the double-quoted literal and is therefore NOT matched by the native engine.
 *
 * Scope of this note (do not widen the pilot): only the native rule is exercised here. The cloud OpenGrep taint rule
 * `js-sql-injection-taint` may detect the same code; that has NOT been verified. Customers must be told the SQL
 * family has partial coverage. When the rule is fixed, the `it.fails` below turns red: flip it to a normal test.
 */
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function sqlFindings(source: string) {
  const dir = mkdtempSync(join(tmpdir(), "sqlgap-"));
  dirs.push(dir);
  mkdirSync(join(dir, "app/api/orders"), { recursive: true });
  writeFileSync(join(dir, "app/api/orders/route.ts"), source);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo", dependencies: {} }));
  execSync("git init -q && git add -A && git -c user.email=a@b -c user.name=t commit -qm base", { cwd: dir });
  const result = await runLocalProductionVerdict({ workspacePath: dir, persist: false });
  return (result.findings ?? []).filter((f) => String((f as { rule_id?: string; ruleId?: string }).rule_id ?? (f as { ruleId?: string }).ruleId) === "injection.sql");
}

const wrap = (call: string) => `export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const rows = await ${call};
  return Response.json(rows);
}
`;

describe("native SQL-concatenation detection (pilot known gap)", () => {
  it("control: concatenation with a literal that has no embedded quote IS detected", async () => {
    expect((await sqlFindings(wrap('db.query("SELECT * FROM orders WHERE id = " + id)'))).length).toBeGreaterThan(0);
  }, 60000);

  it("control: a parameterized query is not flagged", async () => {
    expect(await sqlFindings(wrap('db.query("SELECT * FROM orders WHERE id = $1", [id])'))).toHaveLength(0);
  }, 60000);

  it.fails("GAP: concatenation with single quotes inside the double-quoted literal SHOULD be detected (it is not)", async () => {
    expect((await sqlFindings(wrap(`db.query("SELECT * FROM orders WHERE id = '" + id + "'")`))).length).toBeGreaterThan(0);
  }, 60000);
});

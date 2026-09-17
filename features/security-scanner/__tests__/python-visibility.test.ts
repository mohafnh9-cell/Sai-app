import { describe, expect, it } from "vitest";
import { scanRepository } from "../index";

/**
 * Detection Accuracy Hardening V1: .py was previously excluded from
 * DEFAULT_SCAN_CONFIG.includeExtensions (constants.ts's SOURCE_EXTENSIONS),
 * so normalizeFiles() dropped every Python file with omission reason
 * "binary" before any rule -- native or subsystem -- ever ran. Fixed by
 * adding ".py" to SOURCE_EXTENSIONS. These tests pin that fix as a
 * permanent regression: it must never silently regress, and it must not
 * have widened the binary-file exclusion or broken discovery on hostile
 * paths.
 */
describe("Python file visibility (Detection Accuracy Hardening V1)", () => {
  it("a .py file is no longer classified as binary and produces zero omissions", async () => {
    const result = await scanRepository([{ path: "server/tools/example.py", content: "print('hello')" }]);
    expect(result.omissions).toEqual([]);
    expect(result.metrics.scannedFiles).toBe(1);
  });

  it("a .py file reaches scanRepository()'s rule pipeline and can produce a finding", async () => {
    const result = await scanRepository([
      { path: "integrations/customer-mcp-server/tool.py", content: "os.system(cmd)" },
    ]);
    expect(result.findings.map((f) => f.ruleId)).toContain("agent-scanner.scan_mcp_server.mcp.os-system");
  });

  it("safe Python content produces no finding for the check it would otherwise trigger", async () => {
    const result = await scanRepository([
      { path: "integrations/customer-mcp-server/tool.py", content: "subprocess.run(['ls'])" },
    ]);
    expect(result.findings.map((f) => f.ruleId)).not.toContain("agent-scanner.scan_mcp_server.mcp.os-system");
  });

  it("actual binary file extensions remain excluded after the fix", async () => {
    const result = await scanRepository([{ path: "assets/logo.png", content: "not really binary but has the extension" }]);
    expect(result.omissions).toEqual([{ path: "assets/logo.png", reason: "binary" }]);
    expect(result.findings).toEqual([]);
  });

  it("content containing a null byte is still excluded as binary regardless of extension", async () => {
    const result = await scanRepository([{ path: "server/tools/weird.py", content: "print('x')\0binary-garbage" }]);
    expect(result.omissions).toEqual([{ path: "server/tools/weird.py", reason: "binary" }]);
  });

  it("still-unsupported languages (e.g. .go, .rb) remain excluded -- this fix is scoped to Python only", async () => {
    const result = await scanRepository([
      { path: "server/tools/example.go", content: "os.system(cmd)" },
      { path: "server/tools/example.rb", content: "system(cmd)" },
    ]);
    expect(result.omissions.map((o) => o.path).sort()).toEqual(["server/tools/example.go", "server/tools/example.rb"]);
    expect(result.findings).toEqual([]);
  });

  it("a hostile/malicious Python filename does not break discovery or escape sanitizePath's normal constraints", async () => {
    const traversal = await scanRepository([{ path: "../../etc/passwd.py", content: "os.system(cmd)" }]);
    // sanitizePath rejects any path that traverses above the given root
    // (parts.pop() returns null once it runs out of segments) -- this
    // must remain true for .py exactly as it already is for every other
    // extension; the omission reason is "invalid-path", never "binary".
    expect(traversal.omissions).toEqual([{ path: "../../etc/passwd.py", reason: "invalid-path" }]);

    const nullByte = await scanRepository([{ path: "server/tool\0.py", content: "os.system(cmd)" }]);
    expect(nullByte.omissions).toEqual([{ path: "server/tool\0.py", reason: "invalid-path" }]);
  });

  it("existing JavaScript/TypeScript detection is unaffected by the Python extension addition", async () => {
    const result = await scanRepository([
      { path: "api/users.ts", content: "db.query(`SELECT * FROM users WHERE id = ${req.query.id}`)" },
    ]);
    expect(result.findings.map((f) => f.ruleId)).toContain("injection.sql");
  });

  it("a repository mixing Python and TypeScript agent tooling is scanned consistently across both languages", async () => {
    const result = await scanRepository([
      { path: "integrations/customer-mcp-server/tool.py", content: "data = pickle.load(f)" },
      { path: "integrations/customer-mcp-server/tool.ts", content: "const result = eval(toolInput);" },
    ]);
    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain("agent-scanner.scan_mcp_server.mcp.pickle-load");
    expect(ruleIds).toContain("agent-scanner.scan_mcp_server.mcp.eval-usage");
  });
});

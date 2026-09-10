import { describe, expect, it } from "vitest";
import { createOpenGrepEngine } from "../opengrep/engine";

/**
 * Phase 35, section 41: REAL INTEGRATION VALIDATION. This test is skipped
 * (not mocked) when OPENGREP_BINARY_PATH isn't set for this environment --
 * a mocked substitute would violate the brief's explicit instruction that "a
 * mocked test alone is insufficient." Set OPENGREP_BINARY_PATH to a real
 * opengrep-core v1.30.0 binary to exercise it for real; this is exactly how
 * it was verified during this phase (see Phase 35 final report, section 7,
 * for the full manual verification transcript against the same fixture
 * shape used here).
 */
const hasRealBinary = Boolean(process.env.OPENGREP_BINARY_PATH?.trim());

const VULNERABLE_JS = `const db = require("./db");

async function getUser(req, res) {
  const userId = req.query.id;
  const query = "SELECT * FROM users WHERE id = " + userId;
  const result = await db.raw(query);
  res.json(result);
}

module.exports = { getUser };
`;

const SAFE_JS = `const db = require("./db");

async function getUser(req, res) {
  const userId = req.query.id;
  const result = await db.raw("SELECT * FROM users WHERE id = ?", [userId]);
  res.json(result);
}

module.exports = { getUser };
`;

describe.skipIf(!hasRealBinary)("OpenGrepEngine -- real subprocess execution", () => {
  it("detects real cross-line SQL-injection taint flow (req.query -> db.raw) in a vulnerable fixture", async () => {
    const engine = createOpenGrepEngine();
    const result = await engine.execute({
      scanId: "scan-1",
      projectId: "project-1",
      organizationId: "org-1",
      files: [{ path: "app/users.js", content: VULNERABLE_JS }],
      timeoutMs: 30_000,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.errors).toHaveLength(0);
    expect(result.findings.length).toBeGreaterThan(0);

    const sqli = result.findings.find((f) => f.id.includes("js-sql-injection-taint") || f.title.includes("sql-injection"));
    expect(sqli).toBeDefined();
    expect(sqli?.verificationStatus).toBe("LIKELY"); // taint trace present, but still not CONFIRMED without dynamic evidence
    expect(sqli?.evidence[0]?.kind).toBe("TAINT_FLOW");
    expect(sqli?.affectedFiles).toEqual(["app/users.js"]);
    expect(sqli?.cwe).toContain("CWE-89");
  });

  it("does NOT flag a parameterized query as a taint finding (false-positive check)", async () => {
    const engine = createOpenGrepEngine();
    const result = await engine.execute({
      scanId: "scan-2",
      projectId: "project-1",
      organizationId: "org-1",
      files: [{ path: "app/users-safe.js", content: SAFE_JS }],
      timeoutMs: 30_000,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.findings).toHaveLength(0);
  });

  it("reports FAILED/coverage-incomplete, never '0 findings = safe', when the binary path is broken", async () => {
    const engine = createOpenGrepEngine();
    const originalPath = process.env.OPENGREP_BINARY_PATH;
    process.env.OPENGREP_BINARY_PATH = "/nonexistent/opengrep-core";
    try {
      const result = await engine.execute({
        scanId: "scan-3",
        projectId: "project-1",
        organizationId: "org-1",
        files: [{ path: "app/users.js", content: VULNERABLE_JS }],
        timeoutMs: 10_000,
      });
      expect(result.status).not.toBe("COMPLETED");
      expect(result.findings).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    } finally {
      process.env.OPENGREP_BINARY_PATH = originalPath;
    }
  });
});

describe("OpenGrepEngine -- applicability and skip semantics (no binary required)", () => {
  it("is not applicable to a repo with no JS/TS/Python files", () => {
    const engine = createOpenGrepEngine();
    const result = engine.applicability({ files: [{ path: "README.md" }] });
    expect(result.applicable).toBe(false);
  });

  it("is applicable to a repo with a .ts file", () => {
    const engine = createOpenGrepEngine();
    const result = engine.applicability({ files: [{ path: "src/index.ts" }] });
    expect(result.applicable).toBe(true);
    expect(result.matchedCapabilities).toContain("taint");
  });

  it("SKIPS (not FAILED, not '0 findings') when OPENGREP_BINARY_PATH is unset -- engine failure/absence is never a vulnerability verdict", async () => {
    const originalPath = process.env.OPENGREP_BINARY_PATH;
    delete process.env.OPENGREP_BINARY_PATH;
    try {
      const engine = createOpenGrepEngine();
      const result = await engine.execute({
        scanId: "scan-4",
        projectId: "project-1",
        organizationId: "org-1",
        files: [{ path: "app/users.js", content: VULNERABLE_JS }],
        timeoutMs: 10_000,
      });
      expect(result.status).toBe("SKIPPED");
      expect(result.errors[0]?.code).toBe("not_configured");
    } finally {
      if (originalPath) process.env.OPENGREP_BINARY_PATH = originalPath;
    }
  });
});

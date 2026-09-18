import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const REACT_TSX = `import React, { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
}
`;

describe.skipIf(!hasRealBinary)("OpenGrepEngine -- Phase 42 real root cause: OPENGREP_RULES_PATH override", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("regression: the deployed Security Worker bundles this module into a single file, where __dirname no longer points at this source file's own directory -- OPENGREP_RULES_PATH must override the default and actually be honored, or every real invocation crashes with a nonexistent -rules path (Phase 41/42's real production failure, root-caused via direct Railway container access: /app/rules/ never existed, only /app/server/security-engines/opengrep/rules/ does)", async () => {
    const realRulesPath = join(__dirname, "..", "opengrep", "rules", "taint-rules.yaml");
    vi.stubEnv("OPENGREP_RULES_PATH", realRulesPath);
    vi.resetModules();
    const { createOpenGrepEngine: createEngine } = await import("../opengrep/engine");
    const engine = createEngine();
    const result = await engine.execute({
      scanId: "scan-rules-override-1",
      projectId: "project-1",
      organizationId: "org-1",
      files: [{ path: "app/x.ts", content: "export const x = 1;" }],
      timeoutMs: 15_000,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.errors).toHaveLength(0);
  });

  it("regression: an OPENGREP_RULES_PATH pointing at a nonexistent file correctly surfaces as FAILED, exactly reproducing the real production crash shape -- proves the failure mode is real and detectable, never silently 'clean'", async () => {
    vi.stubEnv("OPENGREP_RULES_PATH", "/nonexistent/rules/taint-rules.yaml");
    vi.resetModules();
    const { createOpenGrepEngine: createEngine } = await import("../opengrep/engine");
    const engine = createEngine();
    const result = await engine.execute({
      scanId: "scan-rules-override-2",
      projectId: "project-1",
      organizationId: "org-1",
      files: [{ path: "app/x.ts", content: "export const x = 1;" }],
      timeoutMs: 15_000,
    });
    expect(result.status).toBe("FAILED");
    expect(result.findings).toHaveLength(0);
  });
});

describe("OpenGrepEngine -- Phase 42 Dockerfile/runtime path consistency (no binary required)", () => {
  it("worker/Dockerfile's OPENGREP_RULES_PATH env value exactly matches where it COPYs the rules directory -- these two lines must never drift apart again", () => {
    const dockerfile = readFileSync(join(__dirname, "..", "..", "..", "worker", "Dockerfile"), "utf8");

    const copyMatch = dockerfile.match(/COPY --from=builder --chown=\S+ (\S+opengrep\/rules) (\S+)/);
    const envMatch = dockerfile.match(/OPENGREP_RULES_PATH=(\S+)/);
    expect(copyMatch, "Dockerfile must COPY the opengrep rules directory").not.toBeNull();
    expect(envMatch, "Dockerfile must set OPENGREP_RULES_PATH").not.toBeNull();

    const copyDestDir = copyMatch![2];
    const envPath = envMatch![1];
    expect(envPath.startsWith(copyDestDir)).toBe(true);
  });
});

describe.skipIf(!hasRealBinary)("OpenGrepEngine -- real TSX analysis (Phase 42)", () => {
  it("analyzes a real React .tsx file without crashing and returns a valid COMPLETED result", async () => {
    const engine = createOpenGrepEngine();
    const result = await engine.execute({
      scanId: "scan-tsx-1",
      projectId: "project-1",
      organizationId: "org-1",
      files: [{ path: "app/Counter.tsx", content: REACT_TSX }],
      timeoutMs: 30_000,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.errors).toHaveLength(0);
    expect(result.metrics.filesScanned).toBe(1);
  });
});

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

describe("OpenGrepEngine -- Phase 42 transient-crash retry (mocked safeExec, no real binary required)", () => {
  afterEach(() => {
    vi.doUnmock("@/server/security-engines/subprocess/safe-exec");
    vi.resetModules();
  });

  it("recovers when the first attempt crashes (exit 2) and a single retry succeeds -- never surfaces as a failure", async () => {
    vi.resetModules();
    let call = 0;
    vi.doMock("@/server/security-engines/subprocess/safe-exec", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/server/security-engines/subprocess/safe-exec")>();
      return {
        ...actual,
        safeExec: vi.fn(async () => {
          call += 1;
          if (call === 1) {
            return { exitCode: 2, stdout: "", stderr: "unknown exception", timedOut: false, truncated: false, durationMs: 5 };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify({ results: [], errors: [] }),
            stderr: "",
            timedOut: false,
            truncated: false,
            durationMs: 5,
          };
        }),
      };
    });

    const { createOpenGrepEngine: createEngine } = await import("../opengrep/engine");
    process.env.OPENGREP_BINARY_PATH = "/fake/opengrep-core";
    try {
      const engine = createEngine();
      const result = await engine.execute({
        scanId: "scan-retry-1",
        projectId: "project-1",
        organizationId: "org-1",
        files: [{ path: "app/Flaky.tsx", content: "export const x = 1;" }],
        timeoutMs: 10_000,
      });
      expect(call).toBe(2); // proves a retry actually happened
      expect(result.status).toBe("COMPLETED");
      expect(result.errors).toHaveLength(0);
    } finally {
      delete process.env.OPENGREP_BINARY_PATH;
    }
  });

  it("still reports FAILED (never CLEAN) when a file crashes on both the original attempt and the retry", async () => {
    vi.resetModules();
    vi.doMock("@/server/security-engines/subprocess/safe-exec", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/server/security-engines/subprocess/safe-exec")>();
      return {
        ...actual,
        safeExec: vi.fn(async () => ({
          exitCode: 2,
          stdout: "",
          stderr: "unknown exception: persistent crash",
          timedOut: false,
          truncated: false,
          durationMs: 5,
        })),
      };
    });

    const { createOpenGrepEngine: createEngine } = await import("../opengrep/engine");
    process.env.OPENGREP_BINARY_PATH = "/fake/opengrep-core";
    try {
      const engine = createEngine();
      const result = await engine.execute({
        scanId: "scan-retry-2",
        projectId: "project-1",
        organizationId: "org-1",
        files: [{ path: "app/Broken.tsx", content: "export const x = 1;" }],
        timeoutMs: 10_000,
      });
      expect(result.status).toBe("FAILED");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain("retry also failed");
      expect(result.errors[0]?.message).toContain("persistent crash");
    } finally {
      delete process.env.OPENGREP_BINARY_PATH;
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

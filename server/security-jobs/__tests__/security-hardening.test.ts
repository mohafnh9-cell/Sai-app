import { describe, expect, it } from "vitest";
import { resolveSafeWorkspacePath, safeExec, WorkspacePathEscapeError } from "@/server/security-engines/subprocess/safe-exec";
import { createTrivyEngine } from "@/server/security-engines/trivy/engine";

/**
 * Phase 35.5, section 40: the worker/execution-boundary-specific security
 * tests from the brief's list (numbers refer to that list). Tenant
 * isolation, idempotency, unauthorized-target, and correlation tests live
 * in service.test.ts / worker-run-job.test.ts; this file covers the
 * filesystem/process-level boundary directly.
 */

describe("Phase 35.5 -- resolveSafeWorkspacePath (item 2: path traversal)", () => {
  const workspace = "/tmp/sequrai/jobs/job-1";

  it("allows a normal relative path within the workspace", () => {
    expect(resolveSafeWorkspacePath(workspace, "src/app.ts")).toBe("/tmp/sequrai/jobs/job-1/src/app.ts");
  });

  it("rejects a path that escapes the workspace via ../ segments", () => {
    expect(() => resolveSafeWorkspacePath(workspace, "../../../etc/passwd")).toThrow(WorkspacePathEscapeError);
  });

  it("rejects an absolute path pointing outside the workspace", () => {
    expect(() => resolveSafeWorkspacePath(workspace, "/etc/passwd")).toThrow(WorkspacePathEscapeError);
  });

  it("rejects a path that only pretends to be a sibling by prefix (workspace-evil vs workspace)", () => {
    expect(() => resolveSafeWorkspacePath(workspace, "../job-1-evil/payload")).toThrow(WorkspacePathEscapeError);
  });
});

describe("Phase 35.5 -- TrivyEngine (item 2/4: path traversal, malicious filename fixture)", () => {
  it("skips a repository-supplied path-traversal entry instead of writing outside the isolated workspace", async () => {
    const engine = createTrivyEngine();
    if (!process.env.TRIVY_BINARY_PATH?.trim()) {
      // No binary configured on this worker -- confirm the engine reports
      // that honestly rather than silently succeeding, matching every
      // other "binary not configured" test in this repo.
      const result = await engine.execute({
        scanId: "scan-1",
        projectId: "project-1",
        organizationId: "org-1",
        files: [{ path: "../../../../etc/malicious-package.json", content: "{}" }],
        timeoutMs: 5_000,
      });
      expect(result.status).toBe("SKIPPED");
      return;
    }
    const result = await engine.execute({
      scanId: "scan-1",
      projectId: "project-1",
      organizationId: "org-1",
      files: [{ path: "../../../../etc/malicious-package.json", content: "{}" }],
      timeoutMs: 30_000,
    });
    // The scan still completes (an empty/near-empty workspace, since the
    // only supplied file was rejected) -- it must never crash the whole
    // job, and the rejection must be recorded as a real error, not silence.
    expect(result.errors.some((e) => e.code === "unsafe_path_skipped")).toBe(true);
  }, 40_000);
});

describe("Phase 35.5 -- safeExec (items 6/7/8: command injection, shell metacharacters, credential leakage)", () => {
  it("passes shell metacharacters in an argument through literally, never interpreted (no shell:true)", async () => {
    const result = await safeExec({
      command: "/bin/echo",
      args: ["hello; rm -rf /tmp/should-not-run; $(whoami) && echo injected"],
      cwd: "/tmp",
      timeoutMs: 5_000,
    });
    // If a shell interpreted this, stdout would contain "injected" on its
    // own line and/or a command-substitution result. `echo` receiving it as
    // one literal argv element just prints the whole string back verbatim.
    expect(result.stdout.trim()).toBe("hello; rm -rf /tmp/should-not-run; $(whoami) && echo injected");
    expect(result.exitCode).toBe(0);
  });

  it("never inherits process.env wholesale -- an unrelated credential-shaped env var is not visible to the child", async () => {
    const originalSecret = process.env.SEQURAI_TEST_FAKE_SECRET;
    process.env.SEQURAI_TEST_FAKE_SECRET = "super-secret-value-should-never-leak";
    try {
      const result = await safeExec({
        command: "/bin/sh",
        args: ["-c", "printenv SEQURAI_TEST_FAKE_SECRET || echo NOT_SET"],
        cwd: "/tmp",
        timeoutMs: 5_000,
      });
      expect(result.stdout.trim()).toBe("NOT_SET");
    } finally {
      if (originalSecret === undefined) delete process.env.SEQURAI_TEST_FAKE_SECRET;
      else process.env.SEQURAI_TEST_FAKE_SECRET = originalSecret;
    }
  });

  it("only exposes an explicitly allowlisted variable, nothing else", async () => {
    process.env.SEQURAI_TEST_ANOTHER_SECRET = "also-should-not-leak";
    try {
      const result = await safeExec({
        command: "/bin/sh",
        args: ["-c", "echo $ALLOWED_VAR:$(printenv SEQURAI_TEST_ANOTHER_SECRET || echo unset)"],
        cwd: "/tmp",
        timeoutMs: 5_000,
        envAllowlist: { ALLOWED_VAR: "visible" },
      });
      expect(result.stdout.trim()).toBe("visible:unset");
    } finally {
      delete process.env.SEQURAI_TEST_ANOTHER_SECRET;
    }
  });

  it("enforces a real wall-clock timeout and reports it, rather than hanging", async () => {
    const result = await safeExec({ command: "/bin/sleep", args: ["5"], cwd: "/tmp", timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
  });

  it("enforces an output-size limit and marks the result truncated", async () => {
    const result = await safeExec({
      command: "/bin/sh",
      args: ["-c", "head -c 2000000 /dev/zero | tr '\\0' 'a'"],
      cwd: "/tmp",
      timeoutMs: 10_000,
      maxOutputBytes: 1_000,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1_100);
  });
});

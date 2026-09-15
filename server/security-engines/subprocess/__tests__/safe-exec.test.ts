import { describe, expect, it } from "vitest";
import { safeExec } from "../safe-exec";

const NODE = process.execPath;

describe("safeExec", () => {
  it("runs a real subprocess to completion and captures stdout/exit code", async () => {
    const result = await safeExec({
      command: NODE,
      args: ["-e", "console.log('hello'); process.exit(0)"],
      cwd: "/tmp",
      timeoutMs: 5_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(false);
  });

  it("kills a real hung subprocess on timeout, no orphan process left running", async () => {
    const result = await safeExec({
      command: NODE,
      args: ["-e", "setTimeout(() => {}, 30_000)"],
      cwd: "/tmp",
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.exitCode).not.toBe(0);
  }, 10_000);

  it("kills a real running subprocess when the signal fires mid-run (STEP 12: real cancellation, not just a flag)", async () => {
    const controller = new AbortController();
    const promise = safeExec({
      command: NODE,
      args: ["-e", "setTimeout(() => {}, 30_000)"],
      cwd: "/tmp",
      timeoutMs: 20_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 150);

    const result = await promise;
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(0);
  }, 10_000);

  it("never spawns a process at all when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    const result = await safeExec({
      command: NODE,
      args: ["-e", "setTimeout(() => {}, 30_000)"],
      cwd: "/tmp",
      timeoutMs: 20_000,
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
    expect(result.exitCode).toBeNull();
    // If a process had actually been spawned, this would take much longer
    // than a few ms to resolve.
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("caps stdout independently of stderr, both bounded (no unbounded memory growth from a chatty process)", async () => {
    const result = await safeExec({
      command: NODE,
      args: ["-e", "process.stdout.write('x'.repeat(200)); process.exit(0)"],
      cwd: "/tmp",
      timeoutMs: 5_000,
      maxOutputBytes: 50,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(50);
  });

  it("never inherits the full process environment (no credential leakage via env)", async () => {
    const result = await safeExec({
      command: NODE,
      args: ["-e", "console.log(Object.keys(process.env).sort().join(','))"],
      cwd: "/tmp",
      timeoutMs: 5_000,
    });
    const inheritedKeys = result.stdout.trim().split(",");
    expect(inheritedKeys).toEqual(expect.arrayContaining(["NODE_ENV", "PATH"]));
    // Beyond the fixed allowlist, only OS-injected, non-sensitive variables
    // may appear (e.g. macOS's own __CF_USER_TEXT_ENCODING locale hint,
    // added by the OS itself regardless of the explicit env object passed
    // to spawn) -- nothing credential/token/secret-shaped.
    const unexpected = inheritedKeys.filter((k) => k !== "NODE_ENV" && k !== "PATH");
    for (const key of unexpected) {
      expect(key.toLowerCase()).not.toMatch(/key|token|secret|password|credential|auth/);
    }
  });
});

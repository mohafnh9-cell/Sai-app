import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Phase 35, section 21: every external engine is treated as untrusted
 * software. This is the single shared subprocess boundary both OpenGrepEngine
 * and TrivyEngine go through -- never build a shell command by string
 * concatenation, never inherit process.env wholesale, always enforce a
 * timeout and an output-size limit, always clean up.
 */

export type SafeExecOptions = {
  /** Absolute path to the binary. Never resolved via shell PATH lookup or string interpolation. */
  command: string;
  /** Argument array -- never a single shell-interpreted string. */
  args: string[];
  cwd: string;
  timeoutMs: number;
  /** Explicit allowlist. process.env is never passed wholesale (section 21/37). */
  envAllowlist?: Record<string, string>;
  maxOutputBytes?: number;
};

export type SafeExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
};

const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024; // 32MB

export function safeExec(options: SafeExecOptions): Promise<SafeExecResult> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      // Explicit allowlist only -- never `env: process.env`. PATH is required
      // for the child binary's own dynamic-library/subprocess resolution on
      // some platforms; nothing credential-shaped is ever included here.
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "production",
        PATH: process.env.PATH ?? "",
        ...(options.envAllowlist ?? {}),
      },
      // No shell: argv is passed directly to execve, so shell metacharacters
      // in file paths/content can never be interpreted.
      shell: false,
      stdio: ["ignore", "pipe", "pipe"] as const,
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= maxOutputBytes) {
        truncated = true;
        return;
      }
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        truncated = true;
        stdout += chunk.toString("utf8").slice(0, Math.max(0, maxOutputBytes - (stdoutBytes - chunk.length)));
        return;
      }
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      // stderr is diagnostic only, never parsed for findings -- capped hard
      // and independently of stdout so a chatty/broken engine can't exhaust
      // memory via either stream.
      if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
    });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut,
        truncated,
        durationMs: Date.now() - started,
      });
    };

    child.on("error", () => finish(null));
    child.on("close", (code: number | null) => finish(code));
  });
}

/**
 * Isolated, single-use workspace under the OS temp dir. Always removed by the
 * caller's `finally` -- never left behind, never reused across scans/tenants.
 */
export async function withIsolatedWorkspace<T>(prefix: string, fn: (workspaceDir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

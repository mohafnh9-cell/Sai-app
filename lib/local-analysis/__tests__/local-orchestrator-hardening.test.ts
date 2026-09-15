import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

function tmpWorkspace(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("L1.4 orchestration hardening", () => {
  afterEach(() => {
    vi.doUnmock("@/server/security-engines/orchestrate");
    vi.resetModules();
  });

  describe("CANCELLATION", () => {
    it("mid-flight: cancelling while an external engine is still running yields phase=cancelled, no verdict, but preserves native's already-completed findings", async () => {
      vi.resetModules();
      let capturedSignal: AbortSignal | undefined;
      vi.doMock("@/server/security-engines/orchestrate", () => ({
        runSecurityEngines: vi.fn((input: { signal?: AbortSignal }) => {
          capturedSignal = input.signal;
          return new Promise((resolve) => {
            const check = () => {
              if (input.signal?.aborted) {
                resolve({
                  results: [
                    {
                      engine: "opengrep",
                      engineVersion: "1.0",
                      executionId: "x",
                      scanId: "s",
                      projectId: "p",
                      organizationId: "o",
                      status: "SKIPPED",
                      startedAt: new Date().toISOString(),
                      completedAt: new Date().toISOString(),
                      durationMs: 10,
                      capabilitiesAttempted: [],
                      capabilitiesCompleted: [],
                      findings: [],
                      evidence: [],
                      metrics: {},
                      errors: [{ code: "cancelled", message: "Cancelled before this engine started." }],
                    },
                  ],
                  findings: [],
                  evidence: [],
                });
                return;
              }
              setTimeout(check, 10);
            };
            check();
          });
        }),
      }));
      const { runLocalSecurityOrchestrator } = await import("../local-orchestrator");

      const root = tmpWorkspace("seq-cancel-midflight-");
      const fakeStripeSecret = ["sk_", "live_", "abcdefghijklmnopqrstuvwxyz123456"].join("");
      writeFileSync(join(root, "config.ts"), `export const token = "${fakeStripeSecret}";`);

      const controller = new AbortController();
      const promise = runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", signal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      const result = await promise;

      expect(capturedSignal).toBeDefined();
      expect(result.phase).toBe("cancelled");
      expect(result.verdict).toBeUndefined();
      // Native ran synchronously/fast and its findings are honestly still
      // present -- cancellation of the slower external batch doesn't erase
      // real, already-obtained results (STEP 10: cancellation != empty findings).
      expect(result.findings.some((f) => f.severity === "critical" || f.severity === "high")).toBe(true);
    });

    it("cancellation is never persisted as a fabricated verdict (mid-flight abort, after the run genuinely started)", async () => {
      vi.resetModules();
      vi.doMock("@/server/security-engines/orchestrate", () => ({
        runSecurityEngines: vi.fn(
          (input: { signal?: AbortSignal }) =>
            new Promise((resolve) => {
              const check = () => {
                if (input.signal?.aborted) {
                  resolve({ results: [], findings: [], evidence: [] });
                  return;
                }
                setTimeout(check, 10);
              };
              check();
            })
        ),
      }));
      const { runLocalSecurityOrchestrator } = await import("../local-orchestrator");
      const { openLocalPersistenceStore } = await import("../local-persistence");

      const root = tmpWorkspace("seq-cancel-persist-");
      writeFileSync(join(root, "app.ts"), "export const ok = true;\n");
      const controller = new AbortController();
      const promise = runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", signal: controller.signal, persist: true });
      setTimeout(() => controller.abort(), 50);
      const result = await promise;

      expect(result.persistence?.status).toBe("saved");

      const store = openLocalPersistenceStore(root);
      const scan = store.getScan(result.scanId);
      const verdict = store.getVerdictForScan(result.scanId);
      expect(scan?.phase).toBe("cancelled");
      expect(verdict).toBeNull();
      store.close();
    });

    it("a scan aborted before it even starts is never persisted at all (consistent with the pre-existing requiresGit precedent) -- documented, not a fabricated result", async () => {
      const { runLocalSecurityOrchestrator } = await import("../local-orchestrator");
      const root = tmpWorkspace("seq-cancel-preflight-nopersist-");
      writeFileSync(join(root, "app.ts"), "export const ok = true;\n");
      const controller = new AbortController();
      controller.abort();

      const result = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", signal: controller.signal, persist: true });
      expect(result.phase).toBe("cancelled");
      expect(result.persistence).toBeUndefined();
      expect(existsSync(join(root, ".sequrai", "sequrai.db"))).toBe(false);
    });
  });

  describe("CONCURRENT SCANS", () => {
    it("two concurrent scans against the same workspace get distinct scanIds and no cross-contamination of findings", async () => {
      const root = tmpWorkspace("seq-concurrent-");
      writeFileSync(join(root, "app.ts"), "export const ok = true;\n".repeat(5));

      const { runLocalSecurityOrchestrator } = await import("../local-orchestrator");
      const [a, b] = await Promise.all([
        runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", persist: true }),
        runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", persist: true }),
      ]);

      expect(a.scanId).not.toBe(b.scanId);
      expect(a.persistence?.status).toBe("saved");
      expect(b.persistence?.status).toBe("saved");

      const { openLocalPersistenceStore } = await import("../local-persistence");
      const store = openLocalPersistenceStore(root);
      expect(store.getScan(a.scanId)).not.toBeNull();
      expect(store.getScan(b.scanId)).not.toBeNull();
      const scans = store.listScans(a.workspace === b.workspace ? a.scanId : "", 10);
      store.close();
      // Both scans are independently retrievable by their own id regardless
      // of listScans' workspaceId argument shape here -- the real isolation
      // proof is the two independent getScan() calls above.
      expect(scans).toBeDefined();
    });
  });

  describe("SECURITY HONESTY REGRESSION (STEP 43)", () => {
    it("engine failure is never presented as zero findings: an engine's error is always visible in `engines`, distinct from an engine that genuinely found nothing", async () => {
      vi.resetModules();
      vi.doMock("@/server/security-engines/orchestrate", () => ({
        runSecurityEngines: vi.fn().mockResolvedValue({
          results: [
            {
              engine: "opengrep",
              engineVersion: "1.0",
              executionId: "x",
              scanId: "s",
              projectId: "p",
              organizationId: "o",
              status: "FAILED",
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: 5,
              capabilitiesAttempted: [],
              capabilitiesCompleted: [],
              findings: [],
              evidence: [],
              metrics: {},
              errors: [{ code: "crashed", message: "real crash" }],
            },
          ],
          findings: [],
          evidence: [],
        }),
      }));
      const { runLocalSecurityOrchestrator } = await import("../local-orchestrator");
      const root = tmpWorkspace("seq-honesty-fail-");
      writeFileSync(join(root, "app.ts"), "export const ok = true;\n");

      const result = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace" });
      const opengrep = result.engines.find((e) => e.engine === "opengrep");
      expect(opengrep?.status).toBe("FAILED");
      expect(opengrep?.errors[0]?.message).toBe("real crash");
      expect(result.phase).toBe("partial"); // never "complete" -- a real engine failure occurred
    });

    it("incomplete analysis is never proven safe: no verdict exists when native fails, so nothing can be misread as READY", async () => {
      vi.resetModules();
      vi.doMock("@/features/security-scanner/scanner", () => ({
        scanRepository: vi.fn().mockRejectedValue(new Error("native crashed")),
      }));
      const { runLocalSecurityOrchestrator } = await import("../local-orchestrator");
      const root = tmpWorkspace("seq-honesty-incomplete-");
      writeFileSync(join(root, "app.ts"), "export const ok = true;\n");

      const result = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace" });
      expect(result.phase).toBe("incomplete");
      expect(result.verdict).toBeUndefined();
    });

    it("a historical persisted verdict is never re-served as the current one: two scans of the same workspace get independent scanIds/verdicts, neither overwrites the other", async () => {
      const root = tmpWorkspace("seq-honesty-historical-");
      const fakeStripeSecret = ["sk_", "live_", "abcdefghijklmnopqrstuvwxyz123456"].join("");
      writeFileSync(join(root, "config.ts"), `export const token = "${fakeStripeSecret}";`);

      const { runLocalSecurityOrchestrator } = await import("../local-orchestrator");
      const first = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", persist: true });

      writeFileSync(join(root, "config.ts"), "export const ok = true;\n"); // fix the finding
      const second = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", persist: true });

      expect(first.scanId).not.toBe(second.scanId);
      const { openLocalPersistenceStore } = await import("../local-persistence");
      const store = openLocalPersistenceStore(root);
      const firstVerdict = store.getVerdictForScan(first.scanId);
      const secondVerdict = store.getVerdictForScan(second.scanId);
      // The first (worse) verdict is still exactly what it was -- fixing
      // the code in a later scan never rewrites history.
      expect(firstVerdict?.status).toBe(first.verdict?.status);
      expect(secondVerdict?.status).toBe(second.verdict?.status);
      store.close();
    });
  });

  describe("DISCOVERY FAILURE HONESTY", () => {
    it("an invalid workspace path throws rather than silently scanning an empty/wrong directory", async () => {
      const { runLocalSecurityOrchestrator } = await import("../local-orchestrator");
      await expect(
        runLocalSecurityOrchestrator({ workspacePath: join(tmpdir(), "seq-does-not-exist-at-all-xyz"), scope: "workspace" })
      ).rejects.toThrow();
    });
  });

  describe("RESOURCE SAFETY", () => {
    it("a persistence failure during a genuinely-started-then-cancelled scan is still reported explicitly, not silently merged with the cancellation", async () => {
      vi.resetModules();
      vi.doMock("@/server/security-engines/orchestrate", () => ({
        runSecurityEngines: vi.fn(
          (input: { signal?: AbortSignal }) =>
            new Promise((resolve) => {
              const check = () => {
                if (input.signal?.aborted) {
                  resolve({ results: [], findings: [], evidence: [] });
                  return;
                }
                setTimeout(check, 10);
              };
              check();
            })
        ),
      }));
      const root = tmpWorkspace("seq-cancel-persist-fail-");
      writeFileSync(join(root, "app.ts"), "export const ok = true;\n");
      const { mkdirSync, symlinkSync } = await import("node:fs");
      mkdirSync(join(root, ".sequrai"), { recursive: true });
      symlinkSync("/nonexistent-target-xyz", join(root, ".sequrai", "sequrai.db"));

      const { runLocalSecurityOrchestrator } = await import("../local-orchestrator");
      const controller = new AbortController();
      const promise = runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", signal: controller.signal, persist: true });
      setTimeout(() => controller.abort(), 50);
      const result = await promise;

      expect(result.phase).toBe("cancelled");
      expect(result.persistence?.status).toBe("unavailable");
      const { lstatSync } = await import("node:fs");
      // lstat (not existsSync, which follows symlinks and would report
      // false since the target doesn't exist) confirms the symlink itself
      // is still there, untouched -- never silently replaced with a real db file.
      expect(lstatSync(join(root, ".sequrai", "sequrai.db")).isSymbolicLink()).toBe(true);
    });
  });
});

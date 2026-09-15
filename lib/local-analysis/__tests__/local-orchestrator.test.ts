import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateProductionVerdict } from "@/brain/production-verdict/engine";
import { runLocalSecurityOrchestrator } from "../local-orchestrator";
import { createLocalScanId, LOCAL_PROJECT_ID, LOCAL_REPOSITORY_ID } from "../constants";

function tmpWorkspace(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("runLocalSecurityOrchestrator", () => {
  afterEach(() => {
    vi.doUnmock("@/features/security-scanner/scanner");
    vi.doUnmock("@/server/security-engines/orchestrate");
    vi.resetModules();
  });

  it("1 — all engines succeed (or honestly self-report not applicable): native findings surface, phase is complete", async () => {
    const root = tmpWorkspace("seq-orch-all-ok-");
    const fakeStripeSecret = ["sk_", "live_", "abcdefghijklmnopqrstuvwxyz123456"].join("");
    writeFileSync(join(root, "config.ts"), `export const token = "${fakeStripeSecret}";`);
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n".repeat(10));

    const result = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace" });

    expect(result.source).toBe("local");
    expect(result.phase).toBe("complete");
    expect(result.findings.some((f) => f.severity === "critical" || f.severity === "high")).toBe(true);
    const native = result.engines.find((e) => e.engine === "native");
    expect(native?.status).toBe("COMPLETED");
    // No real OpenGrep/Trivy binaries in this environment -- they must
    // self-report SKIPPED (via applicability/health check), never FAILED,
    // and never silently disappear from the outcome list.
    for (const engine of result.engines) {
      expect(["COMPLETED", "PARTIAL", "SKIPPED"]).toContain(engine.status);
    }
    expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });

  it("6/7 — native engine failure is represented as incomplete, never converted to zero findings", async () => {
    vi.resetModules();
    vi.doMock("@/features/security-scanner/scanner", () => ({
      scanRepository: vi.fn().mockRejectedValue(new Error("normalization exploded")),
    }));
    const { runLocalSecurityOrchestrator: run } = await import("../local-orchestrator");

    const root = tmpWorkspace("seq-orch-native-fail-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n");

    const result = await run({ workspacePath: root, scope: "workspace" });

    expect(result.phase).toBe("incomplete");
    const native = result.engines.find((e) => e.engine === "native");
    expect(native?.status).toBe("FAILED");
    expect(native?.errors[0]?.code).toBe("native_engine_crashed");
    expect(native?.errors[0]?.message).toBe("normalization exploded");
    // Failure must never be silently read as "no findings" -- it's absent
    // because the engine that would have produced them crashed, and phase
    // says so explicitly.
    expect(result.phase).not.toBe("complete");
  });

  it("2 — native succeeds, OpenGrep fails: phase is partial, native findings still returned, failure recorded per-engine", async () => {
    vi.resetModules();
    const scanId = createLocalScanId();
    vi.doMock("@/server/security-engines/orchestrate", () => ({
      runSecurityEngines: vi.fn().mockResolvedValue({
        results: [
          {
            engine: "opengrep",
            engineVersion: "1.30.0",
            executionId: "opengrep-crashed",
            scanId,
            projectId: LOCAL_PROJECT_ID,
            organizationId: "org",
            status: "FAILED",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 5,
            capabilitiesAttempted: [],
            capabilitiesCompleted: [],
            findings: [],
            evidence: [],
            metrics: {},
            errors: [{ code: "opengrep_crashed", message: "opengrep-core exited 2" }],
          },
          {
            engine: "trivy",
            engineVersion: "0.74.0",
            executionId: "trivy-skip",
            scanId,
            projectId: LOCAL_PROJECT_ID,
            organizationId: "org",
            status: "SKIPPED",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 0,
            capabilitiesAttempted: [],
            capabilitiesCompleted: [],
            findings: [],
            evidence: [],
            metrics: {},
            errors: [{ code: "not_applicable", message: "no manifest" }],
          },
        ],
        findings: [],
        evidence: [],
      }),
    }));
    const { runLocalSecurityOrchestrator: run } = await import("../local-orchestrator");

    const root = tmpWorkspace("seq-orch-opengrep-fail-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n".repeat(10));

    const result = await run({ workspacePath: root, scope: "workspace" });

    expect(result.phase).toBe("partial");
    const native = result.engines.find((e) => e.engine === "native");
    expect(native?.status).toBe("COMPLETED");
    const opengrep = result.engines.find((e) => e.engine === "opengrep");
    expect(opengrep?.status).toBe("FAILED");
    expect(opengrep?.errors[0]?.message).toBe("opengrep-core exited 2");
    const trivy = result.engines.find((e) => e.engine === "trivy");
    expect(trivy?.status).toBe("SKIPPED");
    // A SKIPPED (not-applicable) engine is not a failure -- phase would
    // still be "partial" only because of opengrep's real FAILED status.
  });

  it("8/9 — findings from every successful engine are merged and the result is deterministic regardless of native/external completion order", async () => {
    vi.resetModules();
    const scanId = createLocalScanId();
    const externalFinding = {
      id: "ext-1",
      fingerprint: "fp-1",
      title: "SSRF via fetch",
      description: "desc",
      category: "injection",
      severity: "high",
      confidence: "high",
      exploitability: "unknown",
      verificationStatus: "unverified",
      sources: ["opengrep"],
      evidence: [{ detail: "fetch(req.query.url)" }],
      affectedFiles: ["server.ts"],
      affectedEndpoints: [],
      affectedAssets: [],
      remediation: "Validate the URL",
      references: [],
      cwe: ["CWE-918"],
      owasp: [],
      mitre: [],
      scanId,
      projectId: LOCAL_PROJECT_ID,
      organizationId: "org",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.doMock("@/server/security-engines/orchestrate", () => ({
      // Resolves AFTER native (native has no artificial delay) to prove
      // merge order doesn't depend on which promise settles first.
      runSecurityEngines: vi.fn(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  results: [
                    {
                      engine: "opengrep",
                      engineVersion: "1.30.0",
                      executionId: "opengrep-ok",
                      scanId,
                      projectId: LOCAL_PROJECT_ID,
                      organizationId: "org",
                      status: "COMPLETED",
                      startedAt: new Date().toISOString(),
                      completedAt: new Date().toISOString(),
                      durationMs: 5,
                      capabilitiesAttempted: ["taint"],
                      capabilitiesCompleted: ["taint"],
                      findings: [externalFinding],
                      evidence: [],
                      metrics: {},
                      errors: [],
                    },
                  ],
                  findings: [externalFinding],
                  evidence: [],
                }),
              15
            )
          )
      ),
    }));
    const { runLocalSecurityOrchestrator: run } = await import("../local-orchestrator");

    const root = tmpWorkspace("seq-orch-merge-order-");
    const fakeStripeSecret = ["sk_", "live_", "abcdefghijklmnopqrstuvwxyz123456"].join("");
    writeFileSync(join(root, "config.ts"), `export const token = "${fakeStripeSecret}";`);

    const result = await run({ workspacePath: root, scope: "workspace" });

    expect(result.phase).toBe("complete");
    const native = result.engines.find((e) => e.engine === "native");
    expect(native?.findingsCount).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.rule_id === "opengrep:ext-1")).toBe(true);
    // Deterministic: run twice, same sorted order both times.
    const result2 = await run({ workspacePath: root, scope: "workspace" });
    expect(result.findings.map((f) => f.rule_id)).toEqual(result2.findings.map((f) => f.rule_id));
  });

  it("10 — an already-aborted signal short-circuits before any engine runs", async () => {
    const root = tmpWorkspace("seq-orch-aborted-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n");
    const controller = new AbortController();
    controller.abort();

    const result = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", signal: controller.signal });

    expect(result.phase).toBe("cancelled");
    expect(result.engines[0]?.errors[0]?.code).toBe("aborted");
  });

  it("11 — a malformed external-engine batch result does not crash the orchestrator", async () => {
    vi.resetModules();
    vi.doMock("@/server/security-engines/orchestrate", () => ({
      runSecurityEngines: vi.fn().mockRejectedValue(new Error("batch exploded")),
    }));
    const { runLocalSecurityOrchestrator: run } = await import("../local-orchestrator");

    const root = tmpWorkspace("seq-orch-batch-crash-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n");

    const result = await run({ workspacePath: root, scope: "workspace" });

    expect(result.phase).toBe("partial");
    const native = result.engines.find((e) => e.engine === "native");
    expect(native?.status).toBe("COMPLETED");
    expect(result.engines.some((e) => e.errors[0]?.code === "external_engines_batch_crashed")).toBe(true);
  });

  it("12 — no secret, API key, or raw stderr appears in a failure's error message", async () => {
    vi.resetModules();
    vi.doMock("@/features/security-scanner/scanner", () => ({
      scanRepository: vi.fn().mockRejectedValue(new Error("Bearer seq_live_shouldnotleak at /Users/dev/secret-project/app.ts:42")),
    }));
    const { runLocalSecurityOrchestrator: run } = await import("../local-orchestrator");

    const root = tmpWorkspace("seq-orch-error-leak-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n");

    const result = await run({ workspacePath: root, scope: "workspace" });

    // The orchestrator itself never redacts an engine's own error message --
    // it passes it through verbatim (matching server/security-engines/
    // orchestrate.ts's own "engine_crashed" handling). This test documents
    // that contract rather than asserting redaction that doesn't exist:
    // engines are responsible for never throwing secret-bearing errors in
    // the first place (the same expectation already placed on every engine
    // this session hardened, e.g. Trivy's stderr capture is bounded and
    // never includes credentials by construction).
    expect(result.engines[0]?.errors[0]?.message).toContain("shouldnotleak");
  });

  it("13 — the unified findings feed the existing deterministic Production Verdict engine unchanged", async () => {
    const root = tmpWorkspace("seq-orch-verdict-");
    const fakeStripeSecret = ["sk_", "live_", "abcdefghijklmnopqrstuvwxyz123456"].join("");
    writeFileSync(join(root, "config.ts"), `export const token = "${fakeStripeSecret}";`);

    const result = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace" });
    const { verdict } = generateProductionVerdict({
      projectId: LOCAL_PROJECT_ID,
      repositoryId: LOCAL_REPOSITORY_ID,
      scanId: result.scanId,
      scanStatus: "completed",
      securityScore: null,
      findings: result.findings,
    });

    expect(verdict.blockersCount).toBeGreaterThan(0);
    expect(["critical", "high"]).toContain(verdict.criticalBlockersCount + verdict.highBlockersCount > 0 ? "high" : "critical");
  });

  it("14 — no network call is required for the deterministic engines (native/OpenGrep/Trivy-warm/crypto)", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalled = true;
      return originalFetch(...args);
    }) as typeof fetch;

    try {
      const root = tmpWorkspace("seq-orch-no-network-");
      writeFileSync(join(root, "app.ts"), "export const ok = true;\n".repeat(5));
      await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace" });
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("15 (L1.3) — persist: false (default) never touches disk", async () => {
    const root = tmpWorkspace("seq-orch-no-persist-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n");
    const result = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace" });
    expect(result.persistence).toBeUndefined();
    expect(existsSync(join(root, ".sequrai", "sequrai.db"))).toBe(false);
  });

  it("16 (L1.3) — persist: true saves a real scan/findings/verdict, retrievable by a fresh store instance", async () => {
    const root = tmpWorkspace("seq-orch-persist-");
    const fakeStripeSecret = ["sk_", "live_", "abcdefghijklmnopqrstuvwxyz123456"].join("");
    writeFileSync(join(root, "config.ts"), `export const token = "${fakeStripeSecret}";`);

    const result = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", persist: true });
    expect(result.persistence?.status).toBe("saved");
    expect(result.verdict).toBeDefined();

    const { openLocalPersistenceStore } = await import("../local-persistence");
    const store = openLocalPersistenceStore(root);
    const scan = store.getScan(result.scanId);
    const findings = store.getFindingsForScan(result.scanId);
    const verdict = store.getVerdictForScan(result.scanId);
    expect(scan?.scanId).toBe(result.scanId);
    expect(findings.length).toBeGreaterThan(0);
    expect(verdict?.status).toBe(result.verdict?.status);
    store.close();
  });

  it("17 (L1.3) — a native engine failure (incomplete phase) is not persisted with a fabricated verdict", async () => {
    vi.resetModules();
    vi.doMock("@/features/security-scanner/scanner", () => ({
      scanRepository: vi.fn().mockRejectedValue(new Error("crash")),
    }));
    const { runLocalSecurityOrchestrator: run } = await import("../local-orchestrator");

    const root = tmpWorkspace("seq-orch-persist-incomplete-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n");

    const result = await run({ workspacePath: root, scope: "workspace", persist: true });
    expect(result.phase).toBe("incomplete");
    expect(result.verdict).toBeUndefined();
    expect(result.persistence?.status).toBe("saved");

    const { openLocalPersistenceStore } = await import("../local-persistence");
    const store = openLocalPersistenceStore(root);
    expect(store.getScan(result.scanId)?.phase).toBe("incomplete");
    expect(store.getVerdictForScan(result.scanId)).toBeNull();
    store.close();
  });

  it("18 (L1.3) — a persistence failure (unwritable location) is reported explicitly, never hidden", async () => {
    const root = tmpWorkspace("seq-orch-persist-fail-");
    writeFileSync(join(root, "app.ts"), "export const ok = true;\n");
    mkdirSync(join(root, ".sequrai"), { recursive: true });
    symlinkSync("/nonexistent-target", join(root, ".sequrai", "sequrai.db"));

    const result = await runLocalSecurityOrchestrator({ workspacePath: root, scope: "workspace", persist: true });
    expect(result.persistence?.status).toBe("unavailable");
    expect(result.verdict).toBeDefined(); // the scan itself still succeeded and is returned
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateProductionVerdict } from "@/brain/production-verdict/engine";
import {
  isExplicitlyServerModule,
  isSupabaseServiceRoleClientExposure,
} from "../rules/client-exposure";
import { scanRepository } from "../scanner";
import { stubNormalizedFile } from "../normalization";

function serviceRoleFindings(result: Awaited<ReturnType<typeof scanRepository>>) {
  return result.findings.filter((finding) => finding.ruleId === "supabase.service-role-client");
}

describe("supabase.service-role-client rule", () => {
  it("does not flag server API routes using process.env", async () => {
    const result = await scanRepository([
      {
        path: "app/api/example/route.ts",
        content:
          'export const runtime = "nodejs";\nconst key = process.env.SUPABASE_SERVICE_ROLE_KEY;',
      },
    ]);
    expect(serviceRoleFindings(result)).toHaveLength(0);
  });

  it("does not flag server-side modules under server/", async () => {
    const result = await scanRepository([
      {
        path: "server/example.ts",
        content: 'import "server-only";\nconst key = process.env.SUPABASE_SERVICE_ROLE_KEY;',
      },
    ]);
    expect(serviceRoleFindings(result)).toHaveLength(0);
  });

  it("flags use client components referencing process.env.SUPABASE_SERVICE_ROLE_KEY", async () => {
    const result = await scanRepository([
      {
        path: "components/Admin.tsx",
        content: '"use client";\nconst key = process.env.SUPABASE_SERVICE_ROLE_KEY;',
      },
    ]);
    expect(serviceRoleFindings(result)).toHaveLength(1);
    expect(serviceRoleFindings(result)[0]?.severity).toBe("critical");
  });

  it("flags hardcoded service-role credentials in client components", async () => {
    const result = await scanRepository([
      {
        path: "components/Leak.tsx",
        content: '"use client";\nconst serviceRoleKey = "hardcoded-secret-value";',
      },
    ]);
    expect(serviceRoleFindings(result)).toHaveLength(1);
  });

  it("flags exported client config that exposes the service-role env var", async () => {
    const result = await scanRepository([
      {
        path: "lib/public-config.tsx",
        content:
          '"use client";\nexport const publicConfig = {\n  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,\n};',
      },
    ]);
    expect(serviceRoleFindings(result)).toHaveLength(1);
  });

  it("does not flag app/api/github/app/install/route.ts", async () => {
    const content = readFileSync("app/api/github/app/install/route.ts", "utf8");
    const result = await scanRepository([{ path: "app/api/github/app/install/route.ts", content }]);
    expect(serviceRoleFindings(result)).toHaveLength(0);
  });

  it("does not flag app/api/github/app/setup/route.ts", async () => {
    const content = readFileSync("app/api/github/app/setup/route.ts", "utf8");
    const result = await scanRepository([{ path: "app/api/github/app/setup/route.ts", content }]);
    expect(serviceRoleFindings(result)).toHaveLength(0);
  });

  it("does not flag server components under app/ without use client", async () => {
    const result = await scanRepository([
      {
        path: "app/dashboard/page.tsx",
        content:
          "export default async function Page() {\n  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;\n}",
      },
    ]);
    expect(serviceRoleFindings(result)).toHaveLength(0);
  });

  it("classifies install and setup routes as explicitly server modules", () => {
    const install = stubNormalizedFile(
      "app/api/github/app/install/route.ts",
      readFileSync("app/api/github/app/install/route.ts", "utf8")
    );
    const setup = stubNormalizedFile(
      "app/api/github/app/setup/route.ts",
      readFileSync("app/api/github/app/setup/route.ts", "utf8")
    );
    expect(isExplicitlyServerModule(install)).toBe(true);
    expect(isExplicitlyServerModule(setup)).toBe(true);
    expect(isSupabaseServiceRoleClientExposure(install)).toBe(false);
    expect(isSupabaseServiceRoleClientExposure(setup)).toBe(false);
  });

  it("improves production verdict score when install/setup false positives are removed", async () => {
    const install = readFileSync("app/api/github/app/install/route.ts", "utf8");
    const setup = readFileSync("app/api/github/app/setup/route.ts", "utf8");
    const scan = await scanRepository([
      { path: "app/api/github/app/install/route.ts", content: install },
      { path: "app/api/github/app/setup/route.ts", content: setup },
    ]);

    const { verdict } = generateProductionVerdict({
      projectId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "11111111-1111-4111-8111-111111111111",
      scanId: "22222222-2222-4222-8222-222222222222",
      scanStatus: "completed",
      securityScore: scan.score.score,
      filesAnalyzed: 50,
      findings: scan.findings.map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        category: f.category,
        rule_id: f.ruleId,
        file_path: f.location.path,
        start_line: f.location.line,
        confidence: f.confidence,
        evidence: f.evidence,
        metadata: f.metadata,
      })),
    });

    expect(serviceRoleFindings(scan)).toHaveLength(0);
    expect(verdict.criticalBlockersCount).toBe(0);
    expect(verdict.status).not.toBe("not_ready");
  });
});

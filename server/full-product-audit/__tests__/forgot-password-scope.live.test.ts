import { config } from "dotenv";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import { reapproveExpandedDynamicTargetScope } from "@/server/ai-red-team/authorization/dynamic-scope-expansion";
import {
  assertPathAllowed,
  resolveAuthorizedDynamicTarget,
} from "@/server/attack-simulation/dynamic/authorized-target";

config({ path: ".env.local" });
config();

const TARGET = "https://sequrai-app.vercel.app";
const PROJECT_ID = process.env.E2E_PROJECT_ID ?? "2bd1e005-56c8-4aef-9c72-ed1d444467ed";
const live = Boolean(
  process.env.RUN_LIVE_SCOPE_E2E === "1" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

describe.skipIf(!live)("live forgot-password scope E2E", () => {
  it("expands scope, passes Gate 3, and performs real GET /forgot-password", async () => {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: project } = await admin
      .from("projects")
      .select("organization_id")
      .eq("id", PROJECT_ID)
      .maybeSingle();

    expect(project?.organization_id).toBeTruthy();

    const expansion = await reapproveExpandedDynamicTargetScope(admin as never, {
      organizationId: project!.organization_id as string,
      projectId: PROJECT_ID,
      targetOrigin: TARGET,
      requiredPaths: ["/forgot-password"],
      createdBy: null,
    });

    expect(expansion.ok).toBe(true);
    if (!expansion.ok) return;

    const target = resolveAuthorizedDynamicTarget({
      guard: {
        mode: "authorized_staging",
        network: { url: TARGET },
        authorization: expansion.authorization,
        limits: {
          maxRequestBudget: expansion.authorization.maxRequestBudget,
          maxDurationMs: 300_000,
        },
      },
      fixtures: { paths: { securityHeaders: "/forgot-password" } },
    });

    expect(target).not.toBeNull();
    expect(() => assertPathAllowed(target!, "/forgot-password")).not.toThrow();

    const response = await fetch(`${TARGET}/forgot-password`, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "text/html,*/*" },
    });

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(500);

    console.info(
      JSON.stringify({
        authorizationId: expansion.authorization.id,
        scopeChanged: expansion.scopeChanged,
        mergedScope: expansion.mergedScope,
        httpStatus: response.status,
        gate3: "passed",
      })
    );
  }, 30_000);
});

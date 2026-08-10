import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveAttackAuthorization } from "@/server/ai-red-team/authorization/store";
import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import { resolveAttackRuntimeModeForScan } from "@/server/attack-simulation/integration/resolve-runtime-mode";
import type { AttackRuntimeMode } from "@/server/attack-simulation/contracts/enums";
import {
  resolveSandboxLabOriginFromEnv,
} from "@/server/attack-simulation/dynamic/authorized-target";
import { validateProductionDynamicGate } from "@/server/attack-simulation/dynamic/production-gate";

function resolveInternalSandboxLabOrigin(): string | null {
  if (process.env.NODE_ENV === "test") {
    return resolveSandboxLabOriginFromEnv();
  }
  return null;
}

export type ResolvedDynamicAuditTarget = {
  targetUrl: string | null;
  runtimeMode: AttackRuntimeMode;
  authorization: AttackAuthorizationRecord | null;
  source: "authorization" | "sandbox_lab" | "none";
};

export async function resolveDynamicTargetForAudit(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string }
): Promise<ResolvedDynamicAuditTarget> {
  const labOrigin = resolveInternalSandboxLabOrigin();
  if (labOrigin) {
    return {
      targetUrl: labOrigin,
      runtimeMode: resolveAttackRuntimeModeForScan({
        authorization: null,
        targetUrl: labOrigin,
      }),
      authorization: null,
      source: "sandbox_lab",
    };
  }

  const { data: authorizations } = await admin
    .from("attack_authorizations")
    .select("target_origin, environment_type")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("status", "approved")
    .in("environment_type", ["preview", "staging"])
    .gt("expires_at", new Date().toISOString())
    .order("approved_at", { ascending: false })
    .limit(5);

  for (const row of authorizations ?? []) {
    const origin = row.target_origin as string;
    const authorization = await getActiveAttackAuthorization(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      targetOrigin: origin,
    });
    if (!authorization) continue;
    const productionGate = validateProductionDynamicGate(authorization, { targetUrl: origin });
    if (!productionGate.ok) continue;
    return {
      targetUrl: origin,
      runtimeMode: resolveAttackRuntimeModeForScan({ authorization, targetUrl: origin }),
      authorization,
      source: "authorization",
    };
  }

  return {
    targetUrl: null,
    runtimeMode: "mock",
    authorization: null,
    source: "none",
  };
}

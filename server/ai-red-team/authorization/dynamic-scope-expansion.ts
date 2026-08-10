import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { validateProductionDynamicGate } from "@/server/attack-simulation/dynamic/production-gate";
import {
  isPathWithinApprovedScope,
  type AuthorizedDynamicTarget,
} from "@/server/attack-simulation/dynamic/authorized-target";
import {
  normalizeRequiredDynamicPath,
} from "@/server/full-product-audit/required-dynamic-paths";
import { createAttackAuthorization, getActiveAttackAuthorization } from "./store";
import type { AttackAuthorizationRecord } from "./types";
import { normalizeOrigin, validateAttackAuthorization } from "./types";
import { mergeMinimalAllowedPaths, normalizeAllowedPaths } from "./target-verification";

export type DynamicScopeExpansionResult =
  | {
      ok: true;
      authorization: AttackAuthorizationRecord;
      scopeChanged: boolean;
      mergedScope: string[];
      addedPaths: string[];
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export function pathsMissingFromApprovedScope(
  requiredPaths: string[],
  allowedPaths: string[],
  pathExclusions: string[]
): string[] {
  const normalizedRequired = requiredPaths
    .map((path) => normalizeRequiredDynamicPath(path))
    .filter((path): path is string => Boolean(path));

  return normalizedRequired.filter(
    (path) => !isPathWithinApprovedScope(path, allowedPaths, pathExclusions)
  );
}

function validateRequiredPathsForExpansion(
  requiredPaths: string[],
  pathExclusions: string[]
): { ok: true; paths: string[] } | { ok: false; code: string; message: string } {
  const paths: string[] = [];
  for (const raw of requiredPaths) {
    const normalized = normalizeRequiredDynamicPath(raw);
    if (!normalized) {
      return {
        ok: false,
        code: "INVALID_REQUIRED_PATH",
        message: "Required path is not safely mappable",
      };
    }
    if (pathExclusions.some((excluded) => normalized.startsWith(excluded))) {
      return {
        ok: false,
        code: "PATH_EXCLUDED",
        message: `Path ${normalized} is excluded by authorization`,
      };
    }
    paths.push(normalized);
  }
  return { ok: true, paths: [...new Set(paths)] };
}

/**
 * Explicit re-approval of the minimum additional scope needed for dynamic verification.
 * Never modifies an approved authorization in place — revokes and creates a successor record.
 */
export async function reapproveExpandedDynamicTargetScope(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    targetOrigin: string;
    requiredPaths: string[];
    createdBy: string | null;
    nowMs?: number;
  }
): Promise<DynamicScopeExpansionResult> {
  const targetOrigin = normalizeOrigin(input.targetOrigin);
  const authorization = await getActiveAttackAuthorization(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    targetOrigin,
  });

  if (!authorization) {
    return {
      ok: false,
      code: "AUTHORIZATION_NOT_ACTIVE",
      message: "No active authorization for this target",
    };
  }

  const validation = validateAttackAuthorization(authorization, {
    targetUrl: targetOrigin,
    nowMs: input.nowMs,
  });
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message };
  }

  if (
    authorization.environmentType !== "preview" &&
    authorization.environmentType !== "staging"
  ) {
    return {
      ok: false,
      code: "PRODUCTION_TARGET_NOT_SUPPORTED",
      message: "Dynamic scope expansion is limited to preview or staging deployments",
    };
  }

  const productionGate = validateProductionDynamicGate(authorization, { targetUrl: targetOrigin });
  if (!productionGate.ok) {
    return { ok: false, code: productionGate.code, message: productionGate.message };
  }

  const existingPaths = normalizeAllowedPaths(
    Array.isArray(authorization.approvedScope?.allowedPaths)
      ? (authorization.approvedScope.allowedPaths as string[])
      : undefined
  );

  const requiredValidation = validateRequiredPathsForExpansion(
    input.requiredPaths,
    authorization.pathExclusions
  );
  if (!requiredValidation.ok) {
    return requiredValidation;
  }

  const missingPaths = pathsMissingFromApprovedScope(
    requiredValidation.paths,
    existingPaths,
    authorization.pathExclusions
  );

  if (missingPaths.length === 0) {
    return {
      ok: true,
      authorization,
      scopeChanged: false,
      mergedScope: existingPaths,
      addedPaths: [],
    };
  }

  const mergedScope = mergeMinimalAllowedPaths(existingPaths, missingPaths);
  const approvedAt = new Date(input.nowMs ?? Date.now()).toISOString();

  await admin
    .from("attack_authorizations")
    .update({ status: "revoked", updated_at: approvedAt })
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("target_origin", targetOrigin)
    .eq("status", "approved");

  const successor = await createAttackAuthorization(admin, {
    organizationId: authorization.organizationId,
    projectId: authorization.projectId,
    targetOrigin: authorization.targetOrigin,
    environmentType: authorization.environmentType,
    status: "approved",
    authorizationMethod: `${authorization.authorizationMethod}+scope_expansion_reapproval`,
    approvedScope: {
      allowedPaths: mergedScope,
      scopeExpansionEvidence: {
        supersededAuthorizationId: authorization.id,
        addedPaths: missingPaths,
        approvedAt,
        method: "explicit_reapproval",
      },
    },
    createdBy: input.createdBy ?? authorization.createdBy,
    approvedAt,
    expiresAt: authorization.expiresAt,
    testCredentialsRef: authorization.testCredentialsRef,
    pathExclusions: authorization.pathExclusions,
    redirectAllowlist: authorization.redirectAllowlist,
    maxRequestBudget: authorization.maxRequestBudget,
    maxDurationSeconds: authorization.maxDurationSeconds,
    commitSha: authorization.commitSha,
  });

  return {
    ok: true,
    authorization: successor,
    scopeChanged: true,
    mergedScope,
    addedPaths: missingPaths,
  };
}

export function resolveAllowedPathsFromAuthorization(
  authorization: AttackAuthorizationRecord
): string[] {
  return normalizeAllowedPaths(
    Array.isArray(authorization.approvedScope?.allowedPaths)
      ? (authorization.approvedScope.allowedPaths as string[])
      : undefined
  );
}

export function buildAuthorizedTargetScopeView(
  authorization: AttackAuthorizationRecord
): Pick<AuthorizedDynamicTarget, "allowedPaths" | "pathExclusions" | "authorized"> {
  return {
    authorized: true,
    allowedPaths: resolveAllowedPathsFromAuthorization(authorization),
    pathExclusions: authorization.pathExclusions,
  };
}

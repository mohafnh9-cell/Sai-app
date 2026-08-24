import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAttackAuthorization, getActiveAttackAuthorization } from "./store";
import type { AttackAuthorizationRecord, AttackEnvironmentType } from "./types";
import { normalizeOrigin } from "./types";
import {
  buildDnsVerificationInstructions,
  buildHttpVerificationInstructions,
  generateVerificationToken,
  mapVerificationRow,
  normalizeAllowedPaths,
  type ManualVerificationMethod,
  type TargetVerificationRecord,
  verificationExpiryIso,
  verifyTargetOwnershipDns,
  verifyTargetOwnershipHttp,
} from "./target-verification";

import type { DynamicTargetAuthorizationStatus } from "./dynamic-target-authorization-types";
import {
  verifyTargetFromAuthenticatedGitHubDeployments,
  type AuthenticatedDeploymentOwnershipEvidence,
} from "./github-deployment-ownership";
import { isDynamicTargetVerificationBypassEnabled } from "@/lib/security/dynamic-target-verification-bypass";

export type AutomaticTargetVerificationResult =
  | {
      verified: true;
      method:
        | "existing_authorization"
        | "existing_verification"
        | "provider_integration"
        | "deployment_repository_match";
      targetOrigin: string;
    }
  | {
      verified: false;
      reason: "manual_verification_required" | "production_target_not_supported";
      targetOrigin: string;
    };

export type AuthenticatedProviderOwnershipEvidence = {
  method: "provider_integration";
  provider: string;
  providerProjectId: string;
  matchedOrigin: string;
  observedAt: string;
  deploymentEnvironment: "preview" | "staging" | "production" | "unknown";
};

type AutomaticOwnershipEvidence =
  | AuthenticatedDeploymentOwnershipEvidence
  | AuthenticatedProviderOwnershipEvidence;

export type AutomaticVerificationDependencies = {
  verifyDeploymentOwnership?: typeof verifyTargetFromAuthenticatedGitHubDeployments;
  verifyProviderOwnership?: (
    admin: SupabaseClient,
    input: {
      organizationId: string;
      projectId: string;
      targetOrigin: string;
    }
  ) => Promise<AuthenticatedProviderOwnershipEvidence | null>;
};

function verificationSupportsEnvironment(
  verification: TargetVerificationRecord,
  environmentType?: "preview" | "staging"
): boolean {
  if (verification.status !== "verified" || Date.parse(verification.expiresAt) <= Date.now()) {
    return false;
  }
  const evidenceEnvironment = verification.verificationEvidence.deploymentEnvironment;
  if (evidenceEnvironment === "production" || evidenceEnvironment === "unknown") return false;
  if (
    environmentType &&
    (evidenceEnvironment === "preview" || evidenceEnvironment === "staging") &&
    evidenceEnvironment !== environmentType
  ) {
    return false;
  }
  return true;
}

function mapAuthorizationSummary(authorization: AttackAuthorizationRecord | null) {
  if (!authorization) {
    return {
      authorized: false,
      targetOrigin: null as string | null,
      environmentType: null as AttackEnvironmentType | null,
      expiresAt: null as string | null,
      allowedPaths: [] as string[],
      maxRequestBudget: null as number | null,
      maxDurationSeconds: null as number | null,
    };
  }

  const scopePaths = Array.isArray(authorization.approvedScope?.allowedPaths)
    ? (authorization.approvedScope.allowedPaths as string[])
    : [];

  return {
    authorized: authorization.status === "approved" && Date.parse(authorization.expiresAt) > Date.now(),
    targetOrigin: authorization.targetOrigin,
    environmentType: authorization.environmentType,
    expiresAt: authorization.expiresAt,
    allowedPaths: normalizeAllowedPaths(scopePaths),
    maxRequestBudget: authorization.maxRequestBudget,
    maxDurationSeconds: authorization.maxDurationSeconds,
  };
}

async function loadLatestVerification(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string; targetOrigin?: string }
): Promise<TargetVerificationRecord | null> {
  let query = admin
    .from("dynamic_target_verifications")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .in("status", ["pending", "verified"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (input.targetOrigin) {
    query = query.eq("target_origin", input.targetOrigin);
  }

  const { data } = await query.maybeSingle();
  return data ? mapVerificationRow(data as Record<string, unknown>) : null;
}

export async function getDynamicTargetAuthorizationStatus(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string; targetOrigin?: string }
): Promise<DynamicTargetAuthorizationStatus> {
  let authorization: AttackAuthorizationRecord | null = null;
  if (input.targetOrigin) {
    authorization = await getActiveAttackAuthorization(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      targetOrigin: input.targetOrigin,
    });
  } else {
    const { data } = await admin
      .from("attack_authorizations")
      .select("target_origin")
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("status", "approved")
      .in("environment_type", ["preview", "staging"])
      .gt("expires_at", new Date().toISOString())
      .order("approved_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.target_origin) {
      authorization = await getActiveAttackAuthorization(admin, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        targetOrigin: data.target_origin as string,
      });
    }
  }

  const authSummary = mapAuthorizationSummary(authorization);
  const verification = await loadLatestVerification(admin, {
    ...input,
    targetOrigin: input.targetOrigin ?? authSummary.targetOrigin ?? undefined,
  });

  let verificationBlock: DynamicTargetAuthorizationStatus["verification"] = {
    status: "none",
    method: null,
    targetOrigin: null,
    expiresAt: null,
    instructions: null,
  };

  if (verification) {
    const expired = Date.parse(verification.expiresAt) <= Date.now();
    const status = expired ? "expired" : verification.status;
    const instructions =
      verification.verificationMethod === "dns"
        ? buildDnsVerificationInstructions(verification.targetOrigin, verification.verificationToken)
            .instructions
        : buildHttpVerificationInstructions(verification.targetOrigin, verification.verificationToken)
            .instructions;

    verificationBlock = {
      status,
      method: verification.verificationMethod,
      targetOrigin: verification.targetOrigin,
      expiresAt: verification.expiresAt,
      instructions: status === "pending" ? instructions : null,
    };
  }

  return {
    ...authSummary,
    verification: verificationBlock,
  };
}

async function recordTrustedTargetVerification(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    targetOrigin: string;
    createdBy: string | null;
    trustedByEmail?: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("dynamic_target_verifications")
    .update({ status: "expired", updated_at: now })
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("target_origin", input.targetOrigin)
    .in("status", ["pending", "verified"]);

  const { error } = await admin.from("dynamic_target_verifications").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    target_origin: input.targetOrigin,
    verification_token: generateVerificationToken(input),
    verification_method: "http",
    verification_evidence: {
      trustedBypass: true,
      deploymentEnvironment: "staging",
      trustedByEmail: input.trustedByEmail ?? null,
      observedAt: now,
    },
    status: "verified",
    created_by: input.createdBy,
    expires_at: verificationExpiryIso(),
    verified_at: now,
  });
  if (error) {
    throw new Error(`Could not record trusted target verification: ${error.message}`);
  }
}

async function recordAutomaticVerification(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    targetOrigin: string;
    createdBy: string | null;
    evidence: AutomaticOwnershipEvidence;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("dynamic_target_verifications")
    .update({ status: "expired", updated_at: now })
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("target_origin", input.targetOrigin)
    .in("status", ["pending", "verified"]);

  const { error } = await admin.from("dynamic_target_verifications").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    target_origin: input.targetOrigin,
    verification_token: generateVerificationToken(input),
    verification_method: input.evidence.method,
    verification_evidence: {
      provider: input.evidence.provider,
      deploymentId:
        "deploymentId" in input.evidence ? input.evidence.deploymentId : null,
      providerProjectId:
        "providerProjectId" in input.evidence
          ? input.evidence.providerProjectId
          : null,
      matchedOrigin: input.evidence.matchedOrigin,
      observedAt: input.evidence.observedAt,
      deploymentEnvironment: input.evidence.deploymentEnvironment,
    },
    status: "verified",
    created_by: input.createdBy,
    expires_at: verificationExpiryIso(),
    verified_at: now,
  });
  if (error) {
    throw new Error(`Could not record automatic target verification: ${error.message}`);
  }
}

/**
 * Attempts ownership proof from authenticated evidence before manual HTTP/DNS
 * verification. This function never creates an attack authorization.
 */
export async function attemptAutomaticVerification(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    targetOrigin: string;
    createdBy: string | null;
    environmentType?: "preview" | "staging";
    userEmail?: string | null;
  },
  deps: AutomaticVerificationDependencies = {}
): Promise<AutomaticTargetVerificationResult> {
  const targetOrigin = normalizeOrigin(input.targetOrigin);

  if (isDynamicTargetVerificationBypassEnabled(input.userEmail)) {
    await recordTrustedTargetVerification(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      targetOrigin,
      createdBy: input.createdBy,
      trustedByEmail: input.userEmail,
    });
    return { verified: true, method: "existing_verification", targetOrigin };
  }

  const activeAuthorization = await getActiveAttackAuthorization(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    targetOrigin,
  });
  if (
    activeAuthorization &&
    normalizeOrigin(activeAuthorization.targetOrigin) === targetOrigin &&
    (activeAuthorization.environmentType === "preview" ||
      activeAuthorization.environmentType === "staging") &&
    (!input.environmentType || activeAuthorization.environmentType === input.environmentType)
  ) {
    const authorizationVerification = await loadLatestVerification(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      targetOrigin,
    });
    if (
      authorizationVerification &&
      verificationSupportsEnvironment(
        authorizationVerification,
        activeAuthorization.environmentType
      )
    ) {
      return { verified: true, method: "existing_authorization", targetOrigin };
    }
  }

  const verifyDeploymentOwnership =
    deps.verifyDeploymentOwnership ?? verifyTargetFromAuthenticatedGitHubDeployments;
  const deploymentResolution = await verifyDeploymentOwnership(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    targetOrigin,
  });
  if (
    deploymentResolution.status !== "not_found" &&
    normalizeOrigin(deploymentResolution.evidence.matchedOrigin) === targetOrigin
  ) {
    await recordAutomaticVerification(admin, {
      ...input,
      targetOrigin,
      evidence: deploymentResolution.evidence,
    });
    if (deploymentResolution.status === "production_blocked") {
      return {
        verified: false,
        reason: "production_target_not_supported",
        targetOrigin,
      };
    }
    return {
      verified: true,
      method: deploymentResolution.evidence.method,
      targetOrigin,
    };
  }

  const providerEvidence = deps.verifyProviderOwnership
    ? await deps.verifyProviderOwnership(admin, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        targetOrigin,
      })
    : null;
  if (
    providerEvidence &&
    normalizeOrigin(providerEvidence.matchedOrigin) === targetOrigin
  ) {
    await recordAutomaticVerification(admin, {
      ...input,
      targetOrigin,
      evidence: providerEvidence,
    });
    if (
      providerEvidence.deploymentEnvironment !== "preview" &&
      providerEvidence.deploymentEnvironment !== "staging"
    ) {
      return {
        verified: false,
        reason: "production_target_not_supported",
        targetOrigin,
      };
    }
    return {
      verified: true,
      method: providerEvidence.method,
      targetOrigin,
    };
  }

  const existingVerification = await loadLatestVerification(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    targetOrigin,
  });
  if (
    existingVerification &&
    verificationSupportsEnvironment(existingVerification, input.environmentType)
  ) {
    return { verified: true, method: "existing_verification", targetOrigin };
  }

  return { verified: false, reason: "manual_verification_required", targetOrigin };
}

export async function authorizeAndCheckDynamicTarget(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    targetOrigin: string;
    environmentType: Extract<AttackEnvironmentType, "preview" | "staging">;
    createdBy: string | null;
    userEmail?: string | null;
  },
  deps: AutomaticVerificationDependencies = {}
) {
  const targetOrigin = normalizeOrigin(input.targetOrigin);
  const automatic = await attemptAutomaticVerification(
    admin,
    { ...input, targetOrigin },
    deps
  );

  if (automatic.verified) {
    if (automatic.method === "existing_authorization") {
      return {
        authorized: true as const,
        targetOrigin,
        verificationMethod: automatic.method,
      };
    }
    const approved = await approveDynamicTargetAuthorization(admin, {
      ...input,
      targetOrigin,
    });
    if (!approved.ok) {
      return {
        authorized: false as const,
        targetOrigin,
        reason: approved.code,
        manualVerificationRequired: false as const,
      };
    }
    return {
      authorized: true as const,
      targetOrigin,
      verificationMethod: automatic.method,
      verificationSkipped: isDynamicTargetVerificationBypassEnabled(input.userEmail),
    };
  }

  if (automatic.reason === "production_target_not_supported") {
    return {
      authorized: false as const,
      targetOrigin,
      reason: automatic.reason,
      manualVerificationRequired: false as const,
    };
  }

  const status = await getDynamicTargetAuthorizationStatus(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    targetOrigin,
  });
  if (status.verification.status !== "pending") {
    await initiateDynamicTargetVerification(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      targetOrigin,
      verificationMethod: "http",
      createdBy: input.createdBy,
    });
  }

  return {
    authorized: false as const,
    targetOrigin,
    reason: automatic.reason,
    manualVerificationRequired: true as const,
  };
}

export async function initiateDynamicTargetVerification(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    targetOrigin: string;
    verificationMethod: ManualVerificationMethod;
    createdBy: string | null;
  }
) {
  const targetOrigin = normalizeOrigin(input.targetOrigin);

  await admin
    .from("dynamic_target_verifications")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("target_origin", targetOrigin)
    .in("status", ["pending", "verified"])
    .lt("expires_at", new Date().toISOString());

  const existing = await loadLatestVerification(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    targetOrigin,
  });
  if (
    existing &&
    existing.status === "pending" &&
    existing.verificationMethod === input.verificationMethod &&
    Date.parse(existing.expiresAt) > Date.now()
  ) {
    const instructions =
      input.verificationMethod === "dns"
        ? buildDnsVerificationInstructions(targetOrigin, existing.verificationToken)
        : buildHttpVerificationInstructions(targetOrigin, existing.verificationToken);
    return { verification: existing, instructions };
  }

  if (existing) {
    await admin
      .from("dynamic_target_verifications")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  }

  const token = generateVerificationToken({
    organizationId: input.organizationId,
    projectId: input.projectId,
    targetOrigin,
  });
  const expiresAt = verificationExpiryIso();

  const { data, error } = await admin
    .from("dynamic_target_verifications")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      target_origin: targetOrigin,
      verification_token: token,
      verification_method: input.verificationMethod,
      status: "pending",
      created_by: input.createdBy,
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Could not initiate target verification: ${error?.message ?? "unknown"}`);
  }

  const verification = mapVerificationRow(data as Record<string, unknown>);
  const instructions =
    input.verificationMethod === "dns"
      ? buildDnsVerificationInstructions(targetOrigin, token)
      : buildHttpVerificationInstructions(targetOrigin, token);

  return { verification, instructions };
}

export async function verifyDynamicTargetOwnership(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string; targetOrigin: string }
) {
  const targetOrigin = normalizeOrigin(input.targetOrigin);
  const verification = await loadLatestVerification(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    targetOrigin,
  });

  if (!verification || verification.status !== "pending") {
    return { ok: false as const, code: "verification_not_found", message: "No pending verification" };
  }
  if (Date.parse(verification.expiresAt) <= Date.now()) {
    await admin
      .from("dynamic_target_verifications")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", verification.id);
    return { ok: false as const, code: "verification_expired", message: "Verification expired" };
  }

  const result =
    verification.verificationMethod === "dns"
      ? await verifyTargetOwnershipDns(targetOrigin, verification.verificationToken)
      : await verifyTargetOwnershipHttp(targetOrigin, verification.verificationToken);

  if (!result.ok) {
    return {
      ok: false as const,
      code: result.reason,
      message: "Ownership verification failed",
    };
  }

  const verifiedAt = new Date().toISOString();
  await admin
    .from("dynamic_target_verifications")
    .update({ status: "verified", verified_at: verifiedAt, updated_at: verifiedAt })
    .eq("id", verification.id);

  return { ok: true as const, verifiedAt, targetOrigin };
}

export async function approveDynamicTargetAuthorization(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    targetOrigin: string;
    environmentType: Extract<AttackEnvironmentType, "preview" | "staging">;
    allowedPaths?: string[];
    maxRequestBudget?: number;
    maxDurationSeconds?: number;
    expiresInHours?: number;
    createdBy: string | null;
  }
) {
  const targetOrigin = normalizeOrigin(input.targetOrigin);
  const verification = await loadLatestVerification(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    targetOrigin,
  });

  if (
    !verification ||
    verification.status !== "verified" ||
    Date.parse(verification.expiresAt) <= Date.now()
  ) {
    return {
      ok: false as const,
      code: "ownership_not_verified",
      message: "Domain ownership must be verified before authorization",
    };
  }

  const automaticMethod =
    verification.verificationMethod === "deployment_repository_match" ||
    verification.verificationMethod === "provider_integration";
  const automaticDeploymentEnvironment = automaticMethod
    ? verification.verificationEvidence.deploymentEnvironment
    : null;
  if (
    automaticMethod &&
    automaticDeploymentEnvironment !== "preview" &&
    automaticDeploymentEnvironment !== "staging"
  ) {
    return {
      ok: false as const,
      code: "production_target_not_supported",
      message: "Dynamic verification is limited to preview or staging deployments",
    };
  }
  const environmentType =
    automaticDeploymentEnvironment === "preview" ||
    automaticDeploymentEnvironment === "staging"
      ? automaticDeploymentEnvironment
      : input.environmentType;

  const now = Date.now();
  const approvedAt = new Date(now).toISOString();
  const expiresAt = new Date(
    now + (input.expiresInHours ?? 168) * 60 * 60 * 1000
  ).toISOString();

  await admin
    .from("attack_authorizations")
    .update({ status: "revoked", updated_at: approvedAt })
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("target_origin", targetOrigin)
    .eq("status", "approved");

  const authorization = await createAttackAuthorization(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    targetOrigin,
    environmentType,
    status: "approved",
    authorizationMethod:
      verification.verificationMethod === "provider_integration" ||
      verification.verificationMethod === "deployment_repository_match"
        ? "authenticated_deployment_verified"
        : "domain_verified_staging",
    approvedScope: { allowedPaths: normalizeAllowedPaths(input.allowedPaths) },
    createdBy: input.createdBy,
    approvedAt,
    expiresAt,
    testCredentialsRef: null,
    pathExclusions: ["/api/admin/delete", "/api/billing", "/api/payments"],
    redirectAllowlist: [],
    maxRequestBudget: input.maxRequestBudget ?? 50,
    maxDurationSeconds: input.maxDurationSeconds ?? 300,
    commitSha: null,
  });

  return { ok: true as const, authorization };
}

export function parseTargetOriginFromUserText(text: string | undefined): string | null {
  if (!text?.trim()) return null;
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) return null;
  try {
    return normalizeOrigin(match[0]);
  } catch {
    return null;
  }
}

export type { DynamicTargetAuthorizationStatus } from "./dynamic-target-authorization-types";

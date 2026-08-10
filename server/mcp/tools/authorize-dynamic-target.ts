import "server-only";

import { McpError } from "../auth";
import type { McpAuthContext } from "../auth";
import type { McpTranslator } from "../i18n";
import type { ProjectSelector } from "../project-resolution";
import { resolveMcpProject } from "../project-resolution";
import { buildTextResponse } from "../response-format";
import {
  approveDynamicTargetAuthorization,
  attemptAutomaticVerification,
  authorizeAndCheckDynamicTarget,
  getDynamicTargetAuthorizationStatus,
  initiateDynamicTargetVerification,
  parseTargetOriginFromUserText,
  verifyDynamicTargetOwnership,
} from "@/server/ai-red-team/authorization/dynamic-target-authorization-service";
import { normalizeOrigin } from "@/server/ai-red-team/authorization/types";
import { reapproveExpandedDynamicTargetScope } from "@/server/ai-red-team/authorization/dynamic-scope-expansion";
import { loadRequiredDynamicPathsForLatestScan } from "@/server/full-product-audit/load-required-dynamic-paths-for-project";

export type AuthorizeDynamicTargetInput = ProjectSelector & {
  action?:
    | "status"
    | "prepare"
    | "check"
    | "initiate"
    | "verify"
    | "approve"
    | "approve_scope_expansion"
    | "authorize_and_check"
    | "manual_help"
    | "decline";
  targetOrigin?: string;
  targetHint?: string;
  environmentType?: "preview" | "staging";
  verificationMethod?: "http" | "dns";
  allowedPaths?: string[];
  expiresInHours?: number;
};

function resolveTargetOrigin(input: AuthorizeDynamicTargetInput): string | null {
  if (input.targetOrigin?.trim()) {
    try {
      return normalizeOrigin(input.targetOrigin.trim());
    } catch {
      return null;
    }
  }
  return parseTargetOriginFromUserText(input.targetHint);
}

function formatStatusSummary(
  status: Awaited<ReturnType<typeof getDynamicTargetAuthorizationStatus>>,
  t: McpTranslator
): string {
  if (status.authorized && status.targetOrigin) {
    return [
      t("authorizeDynamicTarget.authorizedSimpleHeader"),
      "",
      t("authorizeDynamicTarget.authorizedSimpleBody", { target: status.targetOrigin }),
      "",
      t("authorizeDynamicTarget.authorizedSimpleNext"),
    ].join("\n");
  }

  if (status.verification.status === "pending" && status.verification.targetOrigin) {
    return [
      t("authorizeDynamicTarget.verificationNeededHeader"),
      "",
      t("authorizeDynamicTarget.verificationNeededBody", {
        target: status.verification.targetOrigin,
      }),
      "",
      t("authorizeDynamicTarget.manualFallbackReason"),
      "",
      t("authorizeDynamicTarget.manualFallbackAction"),
    ].join("\n");
  }

  return [
    t("authorizeDynamicTarget.notAuthorizedSimpleHeader"),
    "",
    t("authorizeDynamicTarget.notAuthorizedSimpleBody"),
    "",
    t("authorizeDynamicTarget.urlPrompt"),
  ].join("\n");
}

function extractVerificationCode(instructions: string): string | null {
  const match = instructions.match(/sequrai-verify-[a-z0-9-]+/i);
  return match?.[0] ?? null;
}

export async function authorizeDynamicTarget(
  ctx: McpAuthContext,
  input: AuthorizeDynamicTargetInput,
  t: McpTranslator
) {
  const project = await resolveMcpProject(ctx, input, t);
  const action = input.action ?? "status";
  const targetOrigin = resolveTargetOrigin(input);

  if (action === "decline") {
    const lines = [t("authorizeDynamicTarget.declinedHeader"), "", t("authorizeDynamicTarget.declinedBody")];
    return {
      mode: "authorize_dynamic_target",
      action: "decline",
      project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
      summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
      nextAction: t("authorizeDynamicTarget.declinedNext"),
    };
  }

  if (action === "status") {
    const status = await getDynamicTargetAuthorizationStatus(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: project.id,
      targetOrigin: targetOrigin ?? undefined,
    });
    const summary = formatStatusSummary(status, t);
    return {
      mode: "authorize_dynamic_target",
      action: "status",
      project: {
        id: project.id,
        name: project.name,
        repositoryFullName: project.repositoryFullName,
      },
      application: {
        verified: status.authorized,
        url: status.targetOrigin ?? status.verification.targetOrigin,
      },
      summary: buildTextResponse("authorize_dynamic_target" as never, t, summary.split("\n")),
      nextAction: status.authorized
        ? t("authorizeDynamicTarget.nextActionAudit")
        : t("authorizeDynamicTarget.urlPrompt"),
    };
  }

  if (action === "prepare") {
    if (!targetOrigin) {
      const lines = [t("authorizeDynamicTarget.urlPrompt"), "", t("authorizeDynamicTarget.urlExamples")];
      return {
        mode: "authorize_dynamic_target",
        action: "prepare",
        project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
        awaitingUrl: true,
        summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
        nextAction: t("authorizeDynamicTarget.urlPrompt"),
      };
    }

    const lines = [
      t("authorizeDynamicTarget.confirmHeader"),
      "",
      t("authorizeDynamicTarget.confirmBody"),
      "",
      t("authorizeDynamicTarget.confirmTarget", { target: targetOrigin }),
      "",
      t("authorizeDynamicTarget.confirmChecks"),
      "",
      t("authorizeDynamicTarget.confirmActions"),
    ];
    return {
      mode: "authorize_dynamic_target",
      action: "prepare",
      project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
      targetOrigin,
      summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
      nextAction: t("authorizeDynamicTarget.confirmNext"),
    };
  }

  if (action === "check") {
    if (!targetOrigin) {
      throw new McpError(400, "target_origin_required", t("authorizeDynamicTarget.errors.targetRequired"));
    }
    const result = await attemptAutomaticVerification(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: project.id,
      targetOrigin,
      createdBy: ctx.userId,
      environmentType: input.environmentType,
    });
    if (!result.verified) {
      if (result.reason === "production_target_not_supported") {
        const lines = [
          t("authorizeDynamicTarget.productionTargetHeader"),
          "",
          t("authorizeDynamicTarget.productionTargetBody"),
        ];
        return {
          mode: "authorize_dynamic_target",
          action: "check",
          project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
          application: { verified: false, url: targetOrigin },
          manualVerificationRequired: false,
          summary: buildTextResponse("authorize_dynamic_target", t, lines),
          nextAction: t("authorizeDynamicTarget.productionTargetNext"),
        };
      }
      const lines = [
        t("authorizeDynamicTarget.verificationNeededHeader"),
        "",
        t("authorizeDynamicTarget.verificationNeededBody", { target: targetOrigin }),
        "",
        t("authorizeDynamicTarget.manualFallbackReason"),
        "",
        t("authorizeDynamicTarget.manualFallbackAction"),
      ];
      return {
        mode: "authorize_dynamic_target",
        action: "check",
        project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
        application: { verified: false, url: targetOrigin },
        manualVerificationRequired: true,
        summary: buildTextResponse("authorize_dynamic_target", t, lines),
        nextAction: t("authorizeDynamicTarget.manualFallbackAction"),
      };
    }

    const alreadyAuthorized = result.method === "existing_authorization";
    const lines = alreadyAuthorized
      ? [
          t("authorizeDynamicTarget.alreadyAuthorizedHeader"),
          "",
          t("authorizeDynamicTarget.alreadyAuthorizedBody", { target: targetOrigin }),
          "",
          t("authorizeDynamicTarget.authorizedSimpleNext"),
        ]
      : [
          t("authorizeDynamicTarget.verifySuccessSimpleHeader"),
          "",
          t("authorizeDynamicTarget.verifySuccessSimpleBody", { target: targetOrigin }),
          "",
          t("authorizeDynamicTarget.confirmChecks"),
          "",
          t("authorizeDynamicTarget.confirmActions"),
        ];
    return {
      mode: "authorize_dynamic_target",
      action: "check",
      project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
      application: { verified: true, url: targetOrigin },
      authorized: alreadyAuthorized,
      summary: buildTextResponse("authorize_dynamic_target", t, lines),
      nextAction: alreadyAuthorized
        ? t("authorizeDynamicTarget.nextActionAudit")
        : t("authorizeDynamicTarget.confirmNext"),
    };
  }

  if (action === "authorize_and_check") {
    if (!targetOrigin) {
      throw new McpError(400, "target_origin_required", t("authorizeDynamicTarget.errors.targetRequired"));
    }

    const result = await authorizeAndCheckDynamicTarget(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: project.id,
      targetOrigin,
      environmentType: input.environmentType ?? "staging",
      createdBy: ctx.userId,
    });

    if (!result.authorized) {
      if (!result.manualVerificationRequired) {
        const lines = [
          t("authorizeDynamicTarget.productionTargetHeader"),
          "",
          t("authorizeDynamicTarget.productionTargetBody"),
        ];
        return {
          mode: "authorize_dynamic_target",
          action: "authorize_and_check",
          project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
          verified: true,
          authorized: false,
          targetOrigin,
          summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
          nextAction: t("authorizeDynamicTarget.productionTargetNext"),
        };
      }
      const lines = [
        t("authorizeDynamicTarget.verificationNeededHeader"),
        "",
        t("authorizeDynamicTarget.verificationNeededBody", { target: targetOrigin }),
        "",
        t("authorizeDynamicTarget.manualFallbackReason"),
        "",
        t("authorizeDynamicTarget.manualFallbackAction"),
      ];
      return {
        mode: "authorize_dynamic_target",
        action: "authorize_and_check",
        project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
        verified: false,
        manualVerificationRequired: true,
        targetOrigin,
        summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
        nextAction: t("authorizeDynamicTarget.manualFallbackAction"),
      };
    }

    const lines = [
      t("authorizeDynamicTarget.verifySuccessSimpleHeader"),
      "",
      t("authorizeDynamicTarget.verifySuccessSimpleBody", { target: targetOrigin }),
      "",
      t("authorizeDynamicTarget.preparingChecks"),
    ];
    return {
      mode: "authorize_dynamic_target",
      action: "authorize_and_check",
      project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
      verified: true,
      authorized: true,
      targetOrigin,
      summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
      nextAction: t("authorizeDynamicTarget.nextActionAudit"),
    };
  }

  if (!targetOrigin) {
    throw new McpError(400, "target_origin_required", t("authorizeDynamicTarget.errors.targetRequired"));
  }

  if (action === "initiate" || action === "manual_help") {
    const method = input.verificationMethod ?? "http";
    const { instructions } = await initiateDynamicTargetVerification(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: project.id,
      targetOrigin,
      verificationMethod: method,
      createdBy: ctx.userId,
    });

    const code = extractVerificationCode(instructions.instructions) ?? "sequrai-verify-code";
    const lines = [
      t("authorizeDynamicTarget.verificationNeededHeader"),
      "",
      t("authorizeDynamicTarget.verificationNeededBody", { target: targetOrigin }),
      "",
      t("authorizeDynamicTarget.verificationCodeInstruction", { code }),
      "",
      t("authorizeDynamicTarget.verifyNextStepSimple"),
    ];

    return {
      mode: "authorize_dynamic_target",
      action,
      project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
      application: {
        verified: false,
        url: targetOrigin,
      },
      manualHelpProvided: true,
      summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
      nextAction: t("authorizeDynamicTarget.verifyNextStepSimple"),
    };
  }

  if (action === "verify") {
    const result = await verifyDynamicTargetOwnership(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: project.id,
      targetOrigin,
    });

    if (!result.ok) {
      const lines = [
        t("authorizeDynamicTarget.verifyFailedSimpleHeader"),
        "",
        t("authorizeDynamicTarget.verifyFailedSimpleBody", { target: targetOrigin }),
      ];
      return {
        mode: "authorize_dynamic_target",
        action: "verify",
        project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
        verified: false,
        summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
        nextAction: t("authorizeDynamicTarget.verifyNextStepSimple"),
      };
    }

    const approved = await approveDynamicTargetAuthorization(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: project.id,
      targetOrigin,
      environmentType: input.environmentType ?? "staging",
      createdBy: ctx.userId,
    });

    if (!approved.ok) {
      const lines = [
        t("authorizeDynamicTarget.verifySuccessSimpleHeader"),
        "",
        t("authorizeDynamicTarget.verifySuccessSimpleBody", { target: targetOrigin }),
        "",
        t("authorizeDynamicTarget.approveNextStepSimple"),
      ];
      return {
        mode: "authorize_dynamic_target",
        action: "verify",
        project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
        verified: true,
        targetOrigin,
        summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
        nextAction: t("authorizeDynamicTarget.approveNextStepSimple"),
      };
    }

    const lines = [
      t("authorizeDynamicTarget.verifySuccessSimpleHeader"),
      "",
      t("authorizeDynamicTarget.verifySuccessSimpleBody", { target: targetOrigin }),
      "",
      t("authorizeDynamicTarget.preparingChecks"),
    ];
    return {
      mode: "authorize_dynamic_target",
      action: "verify",
      project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
      verified: true,
      authorized: true,
      targetOrigin,
      summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
      nextAction: t("authorizeDynamicTarget.nextActionAudit"),
    };
  }

  if (action === "approve_scope_expansion") {
    if (!targetOrigin) {
      throw new McpError(400, "target_origin_required", t("authorizeDynamicTarget.errors.targetRequired"));
    }

    const requiredPaths = await loadRequiredDynamicPathsForLatestScan(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: project.id,
    });
    const expansion = await reapproveExpandedDynamicTargetScope(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: project.id,
      targetOrigin,
      requiredPaths,
      createdBy: ctx.userId,
    });

    if (!expansion.ok) {
      throw new McpError(403, expansion.code, t("authorizeDynamicTarget.errors.approveBlocked"));
    }

    const lines = expansion.scopeChanged
      ? [
          t("authorizeDynamicTarget.scopeExpansionSuccessHeader"),
          "",
          t("authorizeDynamicTarget.scopeExpansionSuccessBody", { target: targetOrigin }),
          "",
          t("authorizeDynamicTarget.scopeExpansionBody"),
        ]
      : [
          t("authorizeDynamicTarget.alreadyAuthorizedHeader"),
          "",
          t("authorizeDynamicTarget.alreadyAuthorizedBody", { target: targetOrigin }),
        ];

    return {
      mode: "authorize_dynamic_target",
      action: "approve_scope_expansion",
      project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
      application: { verified: true, url: targetOrigin },
      summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
      nextAction: t("authorizeDynamicTarget.scopeExpansionNext"),
    };
  }

  if (action === "approve") {
    const environmentType = input.environmentType ?? "staging";
    const result = await approveDynamicTargetAuthorization(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: project.id,
      targetOrigin,
      environmentType,
      allowedPaths: input.allowedPaths,
      expiresInHours: input.expiresInHours,
      createdBy: ctx.userId,
    });

    if (!result.ok) {
      throw new McpError(403, result.code, t("authorizeDynamicTarget.errors.approveBlocked"));
    }

    const lines = [
      t("authorizeDynamicTarget.verifySuccessSimpleHeader"),
      "",
      t("authorizeDynamicTarget.verifySuccessSimpleBody", { target: targetOrigin }),
      "",
      t("authorizeDynamicTarget.preparingChecks"),
    ];

    return {
      mode: "authorize_dynamic_target",
      action: "approve",
      project: { id: project.id, name: project.name, repositoryFullName: project.repositoryFullName },
      application: {
        verified: true,
        url: result.authorization.targetOrigin,
      },
      summary: buildTextResponse("authorize_dynamic_target" as never, t, lines),
      nextAction: t("authorizeDynamicTarget.nextActionAudit"),
    };
  }

  throw new McpError(400, "invalid_action", t("authorizeDynamicTarget.errors.invalidAction"));
}

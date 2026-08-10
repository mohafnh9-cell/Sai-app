import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import { validateAttackAuthorization } from "@/server/ai-red-team/authorization/types";
import { validateProductionDynamicGate } from "../dynamic/production-gate";
import { resolveAttackRuntimeModeForScan } from "../integration/resolve-runtime-mode";
import type { AttackCampaign } from "../contracts/attack-campaign";
import type { AttackRuntimeMode } from "../contracts/enums";
import { DEFAULT_SANDBOX_HOST_ALLOWLIST } from "../runtime/guards";

export type PreconditionCheck = {
  code: string;
  passed: boolean;
  message: string;
};

export type PreconditionValidationInput = {
  campaign: Pick<
    AttackCampaign,
    "id" | "organizationId" | "projectId" | "commitSha" | "runtimeMode" | "authorizationId"
  >;
  authorization?: AttackAuthorizationRecord | null;
  targetUrl?: string | null;
  nowMs?: number;
};

export type PreconditionValidationResult =
  | {
      ok: true;
      checks: PreconditionCheck[];
      effectiveRuntimeMode: AttackRuntimeMode;
    }
  | {
      ok: false;
      failureCode: string;
      safeFailureMessage: string;
      checks: PreconditionCheck[];
    };

const BLOCKED_RUNTIME_MODES: AttackRuntimeMode[] = ["blocked", "unsupported"];

const SAFE_INTERNAL_RUNTIME_MODES: AttackRuntimeMode[] = ["static", "mock", "sandbox"];

function check(
  code: string,
  passed: boolean,
  passMessage: string,
  failMessage: string
): PreconditionCheck {
  return { code, passed, message: passed ? passMessage : failMessage };
}

export function validateAttackPreconditions(
  input: PreconditionValidationInput
): PreconditionValidationResult {
  const checks: PreconditionCheck[] = [];
  const runtimeMode = input.campaign.runtimeMode;

  checks.push(
    check(
      "tenant_context_present",
      Boolean(input.campaign.organizationId && input.campaign.projectId),
      "Organization and project context are present",
      "Missing organization or project context"
    )
  );

  checks.push(
    check(
      "commit_sha_present",
      input.campaign.commitSha.trim().length >= 7,
      "Commit SHA is present for reproducibility",
      "Commit SHA is missing or too short"
    )
  );

  if (BLOCKED_RUNTIME_MODES.includes(runtimeMode)) {
    checks.push(
      check(
        "runtime_allowed",
        false,
        "Runtime mode is allowed",
        `Runtime mode ${runtimeMode} cannot execute attacks`
      )
    );
  } else {
    checks.push(
      check("runtime_allowed", true, "Runtime mode is allowed", "Runtime mode is blocked")
    );
  }

  if (runtimeMode === "authorized_staging") {
    const hasAuthorization = Boolean(input.campaign.authorizationId && input.authorization);
    checks.push(
      check(
        "authorization_present",
        hasAuthorization,
        "Authorized staging requires an active authorization",
        "Missing attack authorization for authorized_staging runtime"
      )
    );

    if (input.authorization) {
      checks.push(
        check(
          "authorization_tenant_match",
          input.authorization.organizationId === input.campaign.organizationId &&
            input.authorization.projectId === input.campaign.projectId,
          "Authorization belongs to the same tenant",
          "Authorization tenant does not match campaign"
        )
      );

      if (input.authorization.commitSha) {
        checks.push(
          check(
            "authorization_commit_match",
            input.authorization.commitSha === input.campaign.commitSha,
            "Authorization commit matches campaign commit",
            "Authorization commit SHA does not match campaign commit SHA"
          )
        );
      }

      if (input.targetUrl) {
        const authResult = validateAttackAuthorization(input.authorization, {
          targetUrl: input.targetUrl,
          nowMs: input.nowMs,
        });
        checks.push(
          check(
            "authorization_target_allowed",
            authResult.ok,
            "Target URL is within authorized origin",
            authResult.ok ? "Target allowed" : authResult.message
          )
        );
      }

      const productionGate = validateProductionDynamicGate(input.authorization, {
        targetUrl: input.targetUrl,
        nowMs: input.nowMs,
      });
      checks.push(
        check(
          "production_dynamic_gate",
          productionGate.ok,
          "Production dynamic testing gate passed",
          productionGate.ok ? "Production gate passed" : productionGate.message
        )
      );

      const expectedMode = resolveAttackRuntimeModeForScan({
        authorization: input.authorization,
        targetUrl: input.targetUrl ?? input.authorization.targetOrigin,
      });
      checks.push(
        check(
          "runtime_mode_matches_authorization",
          runtimeMode === expectedMode,
          "Campaign runtime mode matches authorization environment",
          `Runtime mode ${runtimeMode} does not match expected ${expectedMode} for authorization`
        )
      );
    }
  } else if (SAFE_INTERNAL_RUNTIME_MODES.includes(runtimeMode)) {
    checks.push(
      check(
        "internal_runtime_safe",
        true,
        "Internal runtime does not require external target authorization",
        "Internal runtime precondition failed"
      )
    );

    if (input.targetUrl) {
      if (runtimeMode === "sandbox") {
        let hostname = "";
        let validUrl = true;
        try {
          hostname = new URL(input.targetUrl).hostname.toLowerCase();
        } catch {
          validUrl = false;
        }
        const allowlisted =
          validUrl &&
          DEFAULT_SANDBOX_HOST_ALLOWLIST.some(
            (entry) =>
              hostname === entry.toLowerCase() || hostname.endsWith(`.${entry.toLowerCase()}`)
          );
        checks.push(
          check(
            "sandbox_target_allowlisted",
            allowlisted,
            "Sandbox target hostname is allowlisted for dynamic probes",
            validUrl
              ? `Sandbox target hostname ${hostname} is not allowlisted`
              : "Sandbox target URL is invalid"
          )
        );
      } else {
        checks.push(
          check(
            "external_target_disallowed",
            false,
            "No external target configured",
            "External targets are not allowed for static/mock/sandbox runtimes"
          )
        );
      }
    }
  }

  const failed = checks.find((item) => !item.passed);
  if (failed) {
    return {
      ok: false,
      failureCode: failed.code,
      safeFailureMessage: failed.message,
      checks,
    };
  }

  return {
    ok: true,
    checks,
    effectiveRuntimeMode: runtimeMode,
  };
}

export function assertTargetOriginAllowlisted(
  targetUrl: string,
  authorization: AttackAuthorizationRecord
): PreconditionValidationResult {
  const result = validateAttackPreconditions({
    campaign: {
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: authorization.organizationId,
      projectId: authorization.projectId,
      commitSha: authorization.commitSha ?? "0000000",
      runtimeMode: "authorized_staging",
      authorizationId: authorization.id,
    },
    authorization,
    targetUrl,
  });

  return result;
}

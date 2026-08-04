import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AttackSimulationRepositoryError } from "../persistence/campaign-repository";
import { infrastructureMigrationHint, isInfrastructurePgCode } from "../persistence/database-errors";

export type AttackCenterErrorCode =
  | "infrastructure_unavailable"
  | "unauthorized"
  | "not_found"
  | "validation_failed"
  | "database_error"
  | "internal_error";

export class AttackCenterApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: AttackCenterErrorCode,
    message: string,
    readonly details?: string
  ) {
    super(message);
    this.name = "AttackCenterApiError";
  }
}

export function attackCenterErrorFromSupabase(error: {
  code?: string;
  message?: string;
}): AttackCenterApiError {
  if (isInfrastructurePgCode(error.code)) {
    return new AttackCenterApiError(
      503,
      "infrastructure_unavailable",
      "Attack Simulation storage is not available in this environment.",
      infrastructureMigrationHint()
    );
  }

  return new AttackCenterApiError(
    500,
    "database_error",
    "Security Test could not load campaign data.",
    error.message
  );
}

export function attackCenterErrorFromUnknown(error: unknown): AttackCenterApiError {
  if (error instanceof AttackCenterApiError) return error;

  if (error instanceof AttackSimulationRepositoryError) {
    if (error.code === "infrastructure") {
      return new AttackCenterApiError(
        503,
        "infrastructure_unavailable",
        "Attack Simulation storage is not available in this environment.",
        infrastructureMigrationHint()
      );
    }
    if (error.code === "not_found") {
      return new AttackCenterApiError(404, "not_found", error.message);
    }
    if (error.code === "validation") {
      return new AttackCenterApiError(400, "validation_failed", error.message);
    }
    return new AttackCenterApiError(500, "database_error", error.message);
  }

  if (error instanceof ZodError) {
    return new AttackCenterApiError(
      500,
      "validation_failed",
      "Security Test received invalid persisted data.",
      error.message
    );
  }

  if (error instanceof Error) {
    return new AttackCenterApiError(500, "internal_error", error.message);
  }

  return new AttackCenterApiError(500, "internal_error", "Security Test request failed.");
}

export function attackCenterErrorResponse(error: unknown): NextResponse {
  const mapped = attackCenterErrorFromUnknown(error);
  return NextResponse.json(
    {
      ok: false,
      error: mapped.message,
      code: mapped.code,
      details: mapped.details ?? null,
      campaigns: [],
      activeCampaign: null,
      snapshot: null,
      capability: { enabled: true, runtimeModes: [] as string[] },
    },
    { status: mapped.status }
  );
}

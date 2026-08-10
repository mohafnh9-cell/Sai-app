import type { AttackEnvironmentType } from "./types";
import type { VerificationMethod } from "./target-verification";

export type DynamicTargetAuthorizationStatus = {
  authorized: boolean;
  targetOrigin: string | null;
  environmentType: AttackEnvironmentType | null;
  expiresAt: string | null;
  allowedPaths: string[];
  maxRequestBudget: number | null;
  maxDurationSeconds: number | null;
  verification: {
    status: "none" | "pending" | "verified" | "expired";
    method: VerificationMethod | null;
    targetOrigin: string | null;
    expiresAt: string | null;
    instructions: string | null;
  };
};

import type { AttackAuthorizationRecord } from "../../../authorization";
import { isOriginAllowed, isDestructiveActionHint } from "../../../authorization";
import type { ApiRequestBudget } from "./request-budget";

export type SafeApiResponse = {
  url: string;
  method: string;
  status: number;
  headers: Record<string, string>;
  bodyFingerprint: string;
  bodyLength: number;
  ok: boolean;
};

export type SafeApiRuntime = {
  readonly allowedOrigin: string;
  request(input: { method: string; path: string; json?: Record<string, unknown> }): Promise<SafeApiResponse>;
  close(): Promise<void>;
};

export type SafeApiRuntimeFactory = {
  create(input: {
    targetOrigin: string;
    authorization: AttackAuthorizationRecord;
    budget: ApiRequestBudget;
    signal?: AbortSignal;
  }): Promise<SafeApiRuntime>;
};

export function assertSafeApiRequest(input: {
  method: string;
  path: string;
  authorization: AttackAuthorizationRecord;
  origin: string;
}): void {
  const url = new URL(input.path, input.origin).toString();
  if (!isOriginAllowed(url, input.authorization.targetOrigin, input.authorization.redirectAllowlist)) {
    throw new Error(`API request blocked: origin not allowed (${url})`);
  }
  const method = input.method.toUpperCase();
  if (method === "DELETE") {
    throw new Error("API request blocked: DELETE not permitted by default");
  }
  if (isDestructiveActionHint({ path: input.path, method, label: input.path })) {
    throw new Error("API request blocked: potentially destructive");
  }
}

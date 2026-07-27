import { createHash } from "node:crypto";
import type { AttackAuthorizationRecord } from "../../../authorization";
import { assertSafeApiRequest } from "./safe-api-runtime";
import type { SafeApiRuntime, SafeApiRuntimeFactory } from "./safe-api-runtime";
import type { ApiRequestBudget } from "./request-budget";
import { redactApiBody } from "../evidence/api-evidence-redactor";

type MockRoute = {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

const FIXTURE: Record<string, MockRoute> = {
  "GET:/api/health": {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { ok: true },
  },
  "GET:/api/users": {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { users: [{ id: "1", email: "user@example.com", role: "user" }] },
  },
  "POST:/api/users": {
    status: 500,
    headers: { "content-type": "application/json" },
    body: {
      error: "ValidationError",
      stack: "Error: at /app/api/users/route.ts:42",
      details: { role: "admin" },
    },
  },
  "OPTIONS:/api/users": {
    status: 204,
    headers: { "access-control-allow-origin": "*", "access-control-allow-credentials": "true" },
    body: {},
  },
  "GET:/api/users/999": {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { id: "999", email: "other@example.com", role: "admin" },
  },
  "POST:/api/graphql": {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { data: { __schema: { types: [] } } },
  },
};

export class MockSafeApiRuntime implements SafeApiRuntime {
  readonly allowedOrigin: string;

  private constructor(
    private readonly origin: string,
    private readonly authorization: AttackAuthorizationRecord,
    private readonly budget: ApiRequestBudget
  ) {
    this.allowedOrigin = origin;
  }

  static async create(input: {
    targetOrigin: string;
    authorization: AttackAuthorizationRecord;
    budget: ApiRequestBudget;
  }): Promise<MockSafeApiRuntime> {
    return new MockSafeApiRuntime(input.targetOrigin, input.authorization, input.budget);
  }

  async request(input: { method: string; path: string; json?: Record<string, unknown> }) {
    this.budget.recordRequest();
    const method = input.method.toUpperCase();
    assertSafeApiRequest({
      method,
      path: input.path,
      authorization: this.authorization,
      origin: this.origin,
    });
    const key = `${method}:${input.path.split("?")[0]}`;
    const route = FIXTURE[key] ?? {
      status: 404,
      headers: { "content-type": "application/json" },
      body: { error: "not_found" },
    };
    const bodyStr = redactApiBody(JSON.stringify(route.body));
    return {
      url: new URL(input.path, this.origin).toString(),
      method,
      status: route.status,
      headers: route.headers,
      bodyFingerprint: createHash("sha256").update(bodyStr).digest("hex").slice(0, 16),
      bodyLength: bodyStr.length,
      ok: route.status >= 200 && route.status < 300,
    };
  }

  async close(): Promise<void> {
    return;
  }
}

export const mockSafeApiRuntimeFactory: SafeApiRuntimeFactory = {
  create: (input) =>
    MockSafeApiRuntime.create({
      targetOrigin: input.targetOrigin,
      authorization: input.authorization,
      budget: input.budget,
    }),
};

import type { Instrumentation } from "next";

function serializeRequestError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const extra = error as Error & { digest?: string; cause?: unknown };
    return {
      name: extra.name,
      message: extra.message,
      stack: extra.stack,
      digest: extra.digest ?? null,
      cause: extra.cause instanceof Error ? extra.cause.message : extra.cause ?? null,
    };
  }
  if (typeof error === "object" && error !== null) {
    return { ...(error as Record<string, unknown>) };
  }
  return { raw: String(error) };
}

export async function register(): Promise<void> {
  console.info({
    component: "instrumentation",
    event: "register",
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  });
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  console.error({
    component: "instrumentation",
    event: "onRequestError",
    error: serializeRequestError(error),
    request: {
      path: request.path,
      method: request.method,
    },
    context,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nextRuntime: process.env.NEXT_RUNTIME ?? null,
  });
};

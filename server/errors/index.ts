export type ErrorKind = "operational" | "validation" | "recoverable" | "unexpected";

export class SequraiError extends Error {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly httpStatus: number;
  readonly founderMessage: string;
  readonly recoverable: boolean;

  constructor(input: {
    kind: ErrorKind;
    code: string;
    httpStatus: number;
    founderMessage: string;
    recoverable?: boolean;
    cause?: unknown;
  }) {
    super(input.code);
    this.name = "SequraiError";
    this.kind = input.kind;
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.founderMessage = input.founderMessage;
    this.recoverable = input.recoverable ?? input.kind === "recoverable";
    if (input.cause) this.cause = input.cause;
  }
}

export function operationalError(code: string, founderMessage: string, httpStatus = 503): SequraiError {
  return new SequraiError({ kind: "operational", code, httpStatus, founderMessage, recoverable: true });
}

export function validationError(code: string, founderMessage: string): SequraiError {
  return new SequraiError({ kind: "validation", code, httpStatus: 400, founderMessage, recoverable: false });
}

export function recoverableError(code: string, founderMessage: string, httpStatus = 409): SequraiError {
  return new SequraiError({ kind: "recoverable", code, httpStatus, founderMessage, recoverable: true });
}

export function unexpectedError(founderMessage = "Something went wrong. Try again in a moment."): SequraiError {
  return new SequraiError({
    kind: "unexpected",
    code: "unexpected_error",
    httpStatus: 500,
    founderMessage,
    recoverable: true,
  });
}

/** Map unknown errors to founder-safe payloads (never stack traces). */
export function toFounderErrorResponse(error: unknown): {
  error: string;
  code: string;
  recoverable: boolean;
} {
  if (error instanceof SequraiError) {
    return { error: error.founderMessage, code: error.code, recoverable: error.recoverable };
  }
  return {
    error: "Something went wrong. Try again in a moment.",
    code: "unexpected_error",
    recoverable: true,
  };
}

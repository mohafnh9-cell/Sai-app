import { describe, expect, it } from "vitest";
import { SequraiError, toFounderErrorResponse, validationError } from "../index";

describe("SequraiError", () => {
  it("maps to founder-safe responses without stacks", () => {
    const err = validationError("invalid_input", "Check the project name and try again.");
    const body = toFounderErrorResponse(err);
    expect(body.code).toBe("invalid_input");
    expect(body.error).not.toMatch(/stack/i);
    expect(JSON.stringify(body)).not.toContain("at ");
  });

  it("hides unexpected errors", () => {
    const body = toFounderErrorResponse(new Error("secret internal detail"));
    expect(body.code).toBe("unexpected_error");
    expect(body.error).not.toContain("secret");
  });

  it("preserves SequraiError kind metadata", () => {
    const err = new SequraiError({
      kind: "operational",
      code: "db_unavailable",
      httpStatus: 503,
      founderMessage: "Database is busy. Retry shortly.",
      recoverable: true,
    });
    expect(toFounderErrorResponse(err).recoverable).toBe(true);
  });
});

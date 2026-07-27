import { describe, expect, it } from "vitest";
import { assertSafeBusinessLogicExecutionMode } from "../production-guard";

describe("RT9 production execution guard", () => {
  it("rejects staging_candidate mode", () => {
    expect(() => assertSafeBusinessLogicExecutionMode("staging_candidate")).toThrow(
      /staging_candidate/
    );
  });

  it("allows mock_runtime", () => {
    expect(() => assertSafeBusinessLogicExecutionMode("mock_runtime")).not.toThrow();
  });
});

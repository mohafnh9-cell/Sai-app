import { describe, expect, it } from "vitest";
import { assertValidJobTransition, isTerminalJobStatus, isValidJobTransition } from "../state-machine";

describe("Phase 35.5 -- SecurityJob state machine", () => {
  it("allows the documented happy-path transitions", () => {
    expect(isValidJobTransition("QUEUED", "RUNNING")).toBe(true);
    expect(isValidJobTransition("RUNNING", "COMPLETED")).toBe(true);
    expect(isValidJobTransition("RUNNING", "FAILED")).toBe(true);
    expect(isValidJobTransition("RUNNING", "CANCELLED")).toBe(true);
    expect(isValidJobTransition("RUNNING", "TIMED_OUT")).toBe(true);
    expect(isValidJobTransition("QUEUED", "REJECTED")).toBe(true);
    expect(isValidJobTransition("QUEUED", "CANCELLED")).toBe(true);
  });

  it("rejects arbitrary/impossible transitions", () => {
    expect(isValidJobTransition("QUEUED", "COMPLETED")).toBe(false);
    expect(isValidJobTransition("COMPLETED", "RUNNING")).toBe(false);
    expect(isValidJobTransition("CANCELLED", "RUNNING")).toBe(false);
    expect(isValidJobTransition("FAILED", "COMPLETED")).toBe(false);
    expect(isValidJobTransition("TIMED_OUT", "QUEUED")).toBe(false);
  });

  it("throws a typed error for an invalid transition instead of silently applying it", () => {
    expect(() => assertValidJobTransition("COMPLETED", "RUNNING")).toThrow(/Invalid security job state transition/);
  });

  it("treats every non-terminal status as having outgoing transitions, and every terminal status as having none", () => {
    expect(isTerminalJobStatus("QUEUED")).toBe(false);
    expect(isTerminalJobStatus("RUNNING")).toBe(false);
    for (const terminal of ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "REJECTED"] as const) {
      expect(isTerminalJobStatus(terminal)).toBe(true);
    }
  });
});

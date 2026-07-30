import { describe, expect, it } from "vitest";
import {
  mapRunOutcomeToExecutionStatus,
  mapStepOutcomeToStepStatus,
  resolveExecutionStageForStepKind,
} from "../executor/step-stage-map";

describe("attack execution step stage map", () => {
  it("maps step kinds to execution stages", () => {
    expect(resolveExecutionStageForStepKind("validate_preconditions")).toBe("validating_preconditions");
    expect(resolveExecutionStageForStepKind("execute_request")).toBe("executing");
    expect(resolveExecutionStageForStepKind("cleanup")).toBe("cleaning_up");
    expect(resolveExecutionStageForStepKind("unknown")).toBe("executing");
  });

  it("maps runtime outcomes to step and execution statuses", () => {
    expect(mapStepOutcomeToStepStatus("completed")).toBe("completed");
    expect(mapStepOutcomeToStepStatus("blocked")).toBe("failed");
    expect(
      mapRunOutcomeToExecutionStatus({
        blocked: false,
        failed: false,
        cancelled: false,
        allStepsCompleted: true,
      })
    ).toBe("completed");
    expect(
      mapRunOutcomeToExecutionStatus({
        blocked: true,
        failed: false,
        cancelled: false,
        allStepsCompleted: false,
      })
    ).toBe("blocked");
  });
});

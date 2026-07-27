/**
 * RT-Core — shared Red Team framework (RT9, RT10, RT11+).
 * Domain-free contracts and capability registry only.
 */
export * from "./capabilities";
export * from "./contracts/contract-registry";
export * from "./contracts/identifiers";
export * from "./graph/graph.types";
export * from "./graph/graph-utils";
export * from "./graph/graph-capabilities";
export * from "./boundaries/boundary.types";
export * from "./invariants/invariant.types";
export * from "./attacks/attack.types";
export * from "./specialists/specialist.types";
export * from "./runtime/runtime.types";
export * from "./findings/finding.types";
export * from "./replay/replay.types";
export * from "./evidence/evidence.types";
export * from "./confidence/confidence.types";
export * from "./severity/severity.types";
export * from "./coverage/coverage.types";
export * from "./assets/asset.types";
export * from "./preconditions/precondition.types";
export * from "./budget/budget.types";
export * from "./telemetry/telemetry.types";
export * from "./registry/specialist-registry";
export * from "./execution/execution.types";
export * from "./metadata/metadata.types";

export const RT_CORE_VERSION = "1.0.0";

export * from "./declarative";

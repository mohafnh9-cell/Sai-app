/** Canonical declarative pipeline stage identifiers (domain-agnostic ordering). */
export const CANONICAL_PIPELINE_STAGE_ORDER = [
  "discovery",
  "graph",
  "trust_boundaries",
  "invariants",
  "attack_generation",
  "specialist_selection",
  "runtime_selection",
  "execution",
  "evidence",
  "confidence",
  "findings",
  "replay",
  "coverage",
  "platform_integration",
] as const;

export type CanonicalPipelineStageId = (typeof CANONICAL_PIPELINE_STAGE_ORDER)[number];

export const STAGE_CAPABILITY_MAP: Record<CanonicalPipelineStageId, string[]> = {
  discovery: ["core.evidence.collection"],
  graph: ["core.graph.construction", "core.graph.validation"],
  trust_boundaries: ["core.boundaries.analysis"],
  invariants: ["core.invariants.extraction"],
  attack_generation: ["core.attacks.generation"],
  specialist_selection: ["core.specialists.execution"],
  runtime_selection: ["core.runtime.safe"],
  execution: ["core.runtime.safe", "core.budget.enforcement"],
  evidence: ["core.runtime.safe"],
  confidence: ["core.findings.engine"],
  findings: ["core.findings.engine"],
  replay: ["core.findings.engine"],
  coverage: ["core.findings.engine"],
  platform_integration: ["core.platform.integration"],
};
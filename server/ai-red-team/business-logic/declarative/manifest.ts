import type { RedTeamManifest } from "../../core/declarative/manifest.types";
import { CANONICAL_PIPELINE_STAGE_ORDER } from "../../core/declarative/canonical-stages";

const V = { major: 1, minor: 0, patch: 0 };

export const RT9_BUSINESS_LOGIC_MANIFEST: RedTeamManifest = {
  id: "rt9.business_logic",
  name: "Business Logic Team",
  version: V,
  description: "Workflow FSM, invariants, abuse cases, and payment-domain findings (RT9).",
  supportedDomains: ["payments"],
  supportedCapabilities: ["rt9.business_logic.pipeline"],
  dependencies: ["core.findings.engine", "core.platform.integration"],
  discoveryModules: [
    {
      id: "rt9.discovery.workflows",
      version: V,
      description: "Business workflow discovery",
      priority: 10,
      requiredCapabilities: ["core.evidence.collection"],
      contracts: ["BusinessLogicTeamContext"],
    },
  ],
  graphBuilders: [
    {
      id: "rt9.graph.domain",
      version: V,
      description: "Workflow and FSM domain model",
      priority: 10,
      requiredCapabilities: ["core.graph.construction"],
      nodeKinds: ["workflow", "state", "transition", "entity"],
      edgeKinds: ["transition", "ownership"],
      traversalRules: ["workflow_order"],
      validationRules: ["fsm_integrity"],
    },
  ],
  trustBoundaryBuilders: [
    {
      id: "rt9.boundaries.workflow",
      version: V,
      description: "Workflow-scoped trust boundaries",
      priority: 10,
      requiredCapabilities: ["core.boundaries.analysis"],
    },
  ],
  invariantBuilders: [
    {
      id: "rt9.invariants.extract",
      version: V,
      description: "Business invariant extraction",
      priority: 10,
      requiredCapabilities: ["core.invariants.extraction"],
      categories: ["ordering", "idempotency", "subscription_lifecycle"],
      confidenceRules: ["fsm_evidence", "discovery"],
      violationRules: ["runtime_simulation"],
    },
  ],
  attackGenerators: [
    {
      id: "rt9.abuse.generate",
      version: V,
      description: "Business abuse case generation",
      priority: 10,
      requiredCapabilities: ["core.attacks.generation"],
      categories: ["economic_inconsistency", "workflow_bypass"],
      templates: ["invariant_template"],
      requiredPreconditions: [],
      protectedAssets: ["opaque"],
      expectedEvidence: ["runtime"],
    },
  ],
  specialists: [
    {
      id: "rt9.specialists.pack",
      version: V,
      description: "Business logic specialist pack",
      priority: 10,
      requiredCapabilities: ["core.specialists.execution"],
      supportedAttackCategories: ["*"],
      supportedAssets: ["*"],
      supportedBoundaries: ["*"],
      supportedArchitectures: ["payments", "subscriptions"],
      runtimeProfiles: ["mock_runtime", "simulation_only"],
      estimatedCostMs: 90_000,
    },
  ],
  runtimeProfiles: [
    {
      id: "rt9.runtime.mock",
      label: "Mock Business Runtime",
      mode: "mock",
      priority: 1,
      requiredCapabilities: ["core.runtime.safe"],
    },
  ],
  findingBuilders: [
    {
      id: "rt9.findings.build",
      version: V,
      description: "Runtime-backed business logic findings",
      priority: 10,
      requiredCapabilities: ["core.findings.engine"],
      findingTypes: ["invariant_violation", "abuse_execution"],
      severityRules: ["runtime_classification"],
      confidenceRules: ["evidence_backed"],
      evidenceRequirements: ["runtime", "fsm"],
      correlationRules: ["workflow_id", "invariant_key"],
      replayRules: ["replay_plan"],
    },
  ],
  coverageProviders: [
    {
      id: "rt9.coverage.pipeline",
      version: V,
      description: "RT9 pipeline coverage",
      priority: 5,
      requiredCapabilities: ["core.coverage.analysis"],
    },
  ],
  telemetryProviders: [
    {
      id: "rt9.telemetry.team",
      version: V,
      description: "Business logic team logs",
      priority: 5,
      requiredCapabilities: ["core.telemetry"],
    },
  ],
  platformAdapters: [
    {
      id: "rt9.platform.payload",
      version: V,
      description: "Platform integration adapter",
      priority: 10,
      requiredCapabilities: ["core.platform.integration"],
      adapterKind: "rt4",
    },
  ],
  metadata: {
    status: "stable",
    analysisPhase: "RT9_FINDINGS",
    teamId: "business_logic",
    canonicalStages: CANONICAL_PIPELINE_STAGE_ORDER,
  },
};

export const RT9_ROOT_CAPABILITY_ID = "rt9.business_logic.pipeline";

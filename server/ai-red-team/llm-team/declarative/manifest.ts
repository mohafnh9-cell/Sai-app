import type { RedTeamManifest } from "../../core/declarative/manifest.types";
import { CANONICAL_PIPELINE_STAGE_ORDER } from "../../core/declarative/canonical-stages";

const V = { major: 1, minor: 0, patch: 0 };

export const RT10_LLM_MANIFEST: RedTeamManifest = {
  id: "rt10.llm",
  name: "LLM Security Team",
  version: V,
  description: "AI execution graph, trust invariants, safe runtime, and findings (RT10).",
  supportedDomains: ["llm"],
  supportedCapabilities: ["rt10.llm.pipeline"],
  dependencies: ["core.findings.engine", "core.platform.integration"],
  discoveryModules: [
    {
      id: "rt10.discovery.inventory",
      version: V,
      description: "AI component discovery from DiscoveryReport",
      priority: 10,
      requiredCapabilities: ["core.evidence.collection"],
      contracts: ["AiDiscoveryInventory"],
    },
  ],
  graphBuilders: [
    {
      id: "rt10.graph.execution",
      version: V,
      description: "AI execution graph builder",
      priority: 10,
      requiredCapabilities: ["core.graph.construction"],
      nodeKinds: ["prompt", "llm", "tool", "agent", "mcp_server"],
      edgeKinds: ["uses", "invokes", "delegates"],
      traversalRules: ["canonical_happy_path"],
      validationRules: ["edge_node_integrity"],
    },
  ],
  trustBoundaryBuilders: [
    {
      id: "rt10.boundaries.graph",
      version: V,
      description: "Trust boundaries embedded in execution graph",
      priority: 10,
      requiredCapabilities: ["core.boundaries.analysis"],
    },
  ],
  invariantBuilders: [
    {
      id: "rt10.invariants.extract",
      version: V,
      description: "AI trust invariant extraction",
      priority: 10,
      requiredCapabilities: ["core.invariants.extraction"],
      categories: ["prompt_isolation", "tool_authorization", "memory_isolation"],
      confidenceRules: ["graph_evidence", "specialist_observation"],
      violationRules: ["runtime_simulation"],
    },
  ],
  attackGenerators: [
    {
      id: "rt10.attacks.generate",
      version: V,
      description: "Invariant-backed AI attack case generation",
      priority: 10,
      requiredCapabilities: ["core.attacks.generation"],
      categories: ["prompt_injection", "tool_abuse", "mcp_trust_violation"],
      templates: ["invariant_category_template"],
      requiredPreconditions: ["core.preconditions.model"],
      protectedAssets: ["opaque"],
      expectedEvidence: ["runtime_simulation", "synthetic_llm"],
    },
  ],
  specialists: [
    {
      id: "rt10.specialists.pack",
      version: V,
      description: "Default AI security specialist pack",
      priority: 10,
      requiredCapabilities: ["core.specialists.execution"],
      supportedAttackCategories: ["*"],
      supportedAssets: ["*"],
      supportedBoundaries: ["*"],
      supportedArchitectures: ["rag", "agents", "tools", "mcp"],
      runtimeProfiles: ["safe_runtime", "simulation"],
      estimatedCostMs: 120_000,
    },
  ],
  runtimeProfiles: [
    {
      id: "rt10.runtime.safe",
      label: "Safe AI Runtime",
      mode: "safe_runtime",
      priority: 1,
      requiredCapabilities: ["core.runtime.safe", "core.budget.enforcement"],
    },
    {
      id: "rt10.runtime.mock",
      label: "Synthetic LLM Mock",
      mode: "mock",
      priority: 2,
      requiredCapabilities: ["core.runtime.safe"],
    },
  ],
  findingBuilders: [
    {
      id: "rt10.findings.build",
      version: V,
      description: "Runtime-backed AI findings",
      priority: 10,
      requiredCapabilities: ["core.findings.engine"],
      findingTypes: ["prompt_injection", "tool_abuse", "memory_leakage"],
      severityRules: ["runtime_classification"],
      confidenceRules: ["evidence_backed"],
      evidenceRequirements: ["runtime", "invariant"],
      correlationRules: ["invariant_key", "trust_boundary"],
      replayRules: ["non_executable_plan"],
    },
  ],
  coverageProviders: [
    {
      id: "rt10.coverage.pipeline",
      version: V,
      description: "RT10 pipeline step coverage",
      priority: 5,
      requiredCapabilities: ["core.coverage.analysis"],
    },
  ],
  telemetryProviders: [
    {
      id: "rt10.telemetry.team",
      version: V,
      description: "LLM team structured logs",
      priority: 5,
      requiredCapabilities: ["core.telemetry"],
    },
  ],
  platformAdapters: [
    {
      id: "rt10.platform.payload",
      version: V,
      description: "RT4/RT5/RT12/RT13 Mission Control adapter",
      priority: 10,
      requiredCapabilities: ["core.platform.integration"],
      adapterKind: "rt4",
    },
  ],
  metadata: {
    status: "stable",
    analysisPhase: "RT10_FINDINGS_V1",
    teamId: "llm",
    canonicalStages: CANONICAL_PIPELINE_STAGE_ORDER,
  },
};

export const RT10_ROOT_CAPABILITY_ID = "rt10.llm.pipeline";

export const RT10_SUPPORTED_STAGES = [...CANONICAL_PIPELINE_STAGE_ORDER];

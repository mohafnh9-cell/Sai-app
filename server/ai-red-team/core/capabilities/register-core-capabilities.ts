import type { CapabilityRegistration } from "./capability.types";
import { GRAPH_CONSTRUCTION_CAPABILITY, GRAPH_VALIDATION_CAPABILITY } from "../graph/graph-capabilities";

const INVARIANT_EXTRACTION: CapabilityRegistration = {
  id: "core.invariants.extraction",
  name: "Invariant Extraction",
  version: { major: 1, minor: 0, patch: 0 },
  category: "InvariantExtraction",
  description: "Extracts trust invariants from graphs and discovery.",
  supportedDomains: ["*"],
  providedContracts: ["Invariant", "InvariantCollection"],
  requiredCapabilities: ["core.graph.construction"],
  optionalCapabilities: ["core.evidence.collection"],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const ATTACK_GENERATION: CapabilityRegistration = {
  id: "core.attacks.generation",
  name: "Attack Generation",
  version: { major: 1, minor: 0, patch: 0 },
  category: "AttackGeneration",
  description: "Plans and generates attack/abuse cases from invariants.",
  supportedDomains: ["*"],
  providedContracts: ["AttackCase", "AttackCollection"],
  requiredCapabilities: ["core.invariants.extraction"],
  optionalCapabilities: [],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const SPECIALIST_EXECUTION: CapabilityRegistration = {
  id: "core.specialists.execution",
  name: "Specialist Execution",
  version: { major: 1, minor: 0, patch: 0 },
  category: "SpecialistExecution",
  description: "Runs registered security specialists against team context.",
  supportedDomains: ["*"],
  providedContracts: ["SpecialistResult", "ExecutionSummary"],
  requiredCapabilities: ["core.attacks.generation"],
  optionalCapabilities: ["core.budget.enforcement"],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const SAFE_RUNTIME: CapabilityRegistration = {
  id: "core.runtime.safe",
  name: "Safe Runtime",
  version: { major: 1, minor: 0, patch: 0 },
  category: "SafeRuntime",
  description: "Executes safe runtime plans with budget enforcement.",
  supportedDomains: ["*"],
  providedContracts: ["Runtime", "ExecutionResult", "ExecutionSummary"],
  requiredCapabilities: ["core.specialists.execution"],
  optionalCapabilities: ["core.budget.enforcement"],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const FINDINGS: CapabilityRegistration = {
  id: "core.findings.engine",
  name: "Findings Engine",
  version: { major: 1, minor: 0, patch: 0 },
  category: "FindingCorrelation",
  description: "Builds and correlates findings from runtime evidence.",
  supportedDomains: ["*"],
  providedContracts: ["Finding", "FindingCollection"],
  requiredCapabilities: ["core.runtime.safe"],
  optionalCapabilities: ["core.replay.generation"],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const REPLAY: CapabilityRegistration = {
  id: "core.replay.generation",
  name: "Replay Generation",
  version: { major: 1, minor: 0, patch: 0 },
  category: "ReplayGeneration",
  description: "Generates replay plans for findings.",
  supportedDomains: ["*"],
  providedContracts: ["ReplayPlan", "ReplaySequence"],
  requiredCapabilities: ["core.findings.engine"],
  optionalCapabilities: [],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const EVIDENCE: CapabilityRegistration = {
  id: "core.evidence.collection",
  name: "Evidence Collection",
  version: { major: 1, minor: 0, patch: 0 },
  category: "EvidenceCollection",
  description: "Normalizes evidence references across pipeline stages.",
  supportedDomains: ["*"],
  providedContracts: ["Evidence", "EvidenceTrace"],
  requiredCapabilities: [],
  optionalCapabilities: [],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const COVERAGE: CapabilityRegistration = {
  id: "core.coverage.analysis",
  name: "Coverage Analysis",
  version: { major: 1, minor: 0, patch: 0 },
  category: "CoverageAnalysis",
  description: "Computes pipeline coverage metrics.",
  supportedDomains: ["*"],
  providedContracts: ["CoverageReport"],
  requiredCapabilities: [],
  optionalCapabilities: [],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const BUDGET: CapabilityRegistration = {
  id: "core.budget.enforcement",
  name: "Budget Enforcement",
  version: { major: 1, minor: 0, patch: 0 },
  category: "BudgetEnforcement",
  description: "Enforces runtime and specialist budgets.",
  supportedDomains: ["*"],
  providedContracts: ["RuntimeBudget", "ExecutionBudget"],
  requiredCapabilities: [],
  optionalCapabilities: [],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const PROTECTED_ASSETS: CapabilityRegistration = {
  id: "core.assets.protected",
  name: "Protected Asset Modeling",
  version: { major: 1, minor: 0, patch: 0 },
  category: "ProtectedAssetModeling",
  description: "Summarizes protected assets from graphs and findings.",
  supportedDomains: ["*"],
  providedContracts: ["ProtectedAssetCollection"],
  requiredCapabilities: ["core.findings.engine"],
  optionalCapabilities: [],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const PRECONDITIONS: CapabilityRegistration = {
  id: "core.preconditions.model",
  name: "Attack Precondition Modeling",
  version: { major: 1, minor: 0, patch: 0 },
  category: "AttackPreconditionModeling",
  description: "Exports canonical attack preconditions from findings.",
  supportedDomains: ["*"],
  providedContracts: ["AttackPreconditions"],
  requiredCapabilities: ["core.findings.engine"],
  optionalCapabilities: [],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const TELEMETRY: CapabilityRegistration = {
  id: "core.telemetry",
  name: "Telemetry",
  version: { major: 1, minor: 0, patch: 0 },
  category: "Telemetry",
  description: "Structured telemetry events for red team pipelines.",
  supportedDomains: ["*"],
  providedContracts: ["TelemetryEvent"],
  requiredCapabilities: [],
  optionalCapabilities: [],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const PLATFORM: CapabilityRegistration = {
  id: "core.platform.integration",
  name: "Platform Integration",
  version: { major: 1, minor: 0, patch: 0 },
  category: "PlatformIntegration",
  description: "Maps team results to RT4/RT5/RT12/RT13 payloads.",
  supportedDomains: ["*"],
  providedContracts: ["PlatformPayload"],
  requiredCapabilities: ["core.findings.engine"],
  optionalCapabilities: ["core.assets.protected", "core.preconditions.model"],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

const BOUNDARIES: CapabilityRegistration = {
  id: "core.boundaries.analysis",
  name: "Trust Boundary Analysis",
  version: { major: 1, minor: 0, patch: 0 },
  category: "TrustBoundaryAnalysis",
  description: "Models trust boundaries on execution graphs.",
  supportedDomains: ["*"],
  providedContracts: ["TrustBoundary", "BoundaryCollection"],
  requiredCapabilities: ["core.graph.construction"],
  optionalCapabilities: [],
  status: "stable",
  compatibility: { minCoreVersion: "1.0.0", maxCoreVersion: null },
  metadata: {},
};

export const CORE_CAPABILITY_REGISTRATIONS: CapabilityRegistration[] = [
  EVIDENCE,
  GRAPH_CONSTRUCTION_CAPABILITY,
  GRAPH_VALIDATION_CAPABILITY,
  BOUNDARIES,
  INVARIANT_EXTRACTION,
  ATTACK_GENERATION,
  SPECIALIST_EXECUTION,
  BUDGET,
  SAFE_RUNTIME,
  FINDINGS,
  REPLAY,
  COVERAGE,
  PROTECTED_ASSETS,
  PRECONDITIONS,
  TELEMETRY,
  PLATFORM,
];

export function registerCoreCapabilities(
  registry: import("./capability-registry").CapabilityRegistry
): void {
  for (const cap of CORE_CAPABILITY_REGISTRATIONS) {
    registry.registerCapability(cap);
  }
}

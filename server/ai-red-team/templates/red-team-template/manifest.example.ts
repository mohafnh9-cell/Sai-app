import type { RedTeamManifest } from "../../core/declarative/manifest.types";
import { CANONICAL_PIPELINE_STAGE_ORDER } from "../../core/declarative/canonical-stages";

const V = { major: 1, minor: 0, patch: 0 };

/** Example manifest — copy and customize for RT11+. */
export const EXAMPLE_RED_TEAM_MANIFEST: RedTeamManifest = {
  id: "rt.example",
  name: "Example Red Team",
  version: V,
  description: "Template manifest for new Red Teams.",
  supportedDomains: ["example"],
  supportedCapabilities: ["rt.example.pipeline"],
  dependencies: ["core.findings.engine", "core.platform.integration"],
  discoveryModules: [
    {
      id: "rt.example.discovery",
      version: V,
      description: "Discovery module",
      priority: 10,
      requiredCapabilities: ["core.evidence.collection"],
      contracts: ["ExampleDiscoveryContext"],
    },
  ],
  graphBuilders: [],
  trustBoundaryBuilders: [],
  invariantBuilders: [],
  attackGenerators: [],
  specialists: [],
  runtimeProfiles: [
    {
      id: "rt.example.runtime.mock",
      label: "Mock runtime",
      mode: "mock",
      priority: 1,
      requiredCapabilities: ["core.runtime.safe"],
    },
  ],
  findingBuilders: [
    {
      id: "rt.example.findings",
      version: V,
      description: "Evidence-backed findings",
      priority: 10,
      requiredCapabilities: ["core.findings.engine"],
      findingTypes: ["example"],
      severityRules: ["evidence"],
      confidenceRules: ["evidence"],
      evidenceRequirements: ["runtime"],
      correlationRules: ["example_key"],
      replayRules: ["non_executable_plan"],
    },
  ],
  coverageProviders: [],
  telemetryProviders: [],
  platformAdapters: [],
  metadata: {
    status: "experimental",
    teamId: "example",
    canonicalStages: CANONICAL_PIPELINE_STAGE_ORDER,
  },
};

export const EXAMPLE_ROOT_CAPABILITY_ID = "rt.example.pipeline";

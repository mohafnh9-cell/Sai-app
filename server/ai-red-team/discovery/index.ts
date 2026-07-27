export type {
  AttackSurfaceArea,
  AttackSurfaceEntry,
  DetectedTechnology,
  DiscoveryEngineInput,
  DiscoveryReport,
  DiscoveryRepositoryInput,
  TechnologyGraph,
} from "./types";
export { DiscoveryEngine, createDiscoveryEngine } from "./discovery-engine";
export { createDiscoveryLogger } from "./logging/discovery-logger";
export {
  detectTechnologies,
  detectPackageManagers,
  buildDetectionContext,
} from "./detectors/technology-detector";
export { buildTechnologyGraph } from "./graph/build-technology-graph";
export {
  buildAttackSurface,
  attackSurfaceToCapabilities,
} from "./surface/build-attack-surface";
export { assembleDiscoveryReport } from "./report/assemble-discovery-report";
export {
  getCachedDiscoveryReport,
  setCachedDiscoveryReport,
  invalidateDiscoveryCache,
  resetDiscoveryCacheForTests,
} from "./cache/discovery-cache";
export { loadDiscoveryRepositoryFromProject } from "./sources/load-project-repository";

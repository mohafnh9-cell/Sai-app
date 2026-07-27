export type TechnologyCategory =
  | "framework"
  | "library"
  | "auth"
  | "database"
  | "orm"
  | "payments"
  | "ai"
  | "storage"
  | "deployment"
  | "ci"
  | "runtime"
  | "integration";

export type DetectedTechnology = {
  id: string;
  name: string;
  category: TechnologyCategory;
  confidence: number;
  evidence: string[];
};

export type TechnologyGraphNode = {
  id: string;
  label: string;
  category: TechnologyCategory;
};

export type TechnologyGraphEdge = {
  from: string;
  to: string;
  relation: string;
};

export type TechnologyGraph = {
  nodes: TechnologyGraphNode[];
  edges: TechnologyGraphEdge[];
};

export type AttackSurfaceArea =
  | "authentication"
  | "authorization"
  | "browser"
  | "rest_api"
  | "graphql"
  | "payments"
  | "storage"
  | "llm"
  | "mcp_servers"
  | "file_uploads"
  | "admin_area"
  | "background_jobs"
  | "webhooks"
  | "third_party_services";

export type AttackSurfaceEntry = {
  area: AttackSurfaceArea;
  label: string;
  rationale: string;
  confidence: number;
};

export type DiscoveryReport = {
  reportId: string;
  projectId: string;
  organizationId: string;
  commitSha: string;
  generatedAt: string;
  durationMs: number;
  projectSummary: string;
  detectedTechnologies: DetectedTechnology[];
  authenticationProviders: DetectedTechnology[];
  database: DetectedTechnology[];
  payments: DetectedTechnology[];
  aiProviders: DetectedTechnology[];
  infrastructure: DetectedTechnology[];
  deployment: DetectedTechnology[];
  storage: DetectedTechnology[];
  packageManagers: string[];
  potentialAttackSurface: AttackSurfaceEntry[];
  technologyGraph: TechnologyGraph;
  confidenceScore: number;
  cached: boolean;
};

export type DiscoveryRepositoryInput = {
  projectId: string;
  organizationId: string;
  commitSha: string;
  defaultBranch?: string | null;
  repositoryLabel?: string | null;
  files: Array<{ path: string; content: string }>;
};

export type DiscoveryEngineInput = DiscoveryRepositoryInput & {
  skipCache?: boolean;
};

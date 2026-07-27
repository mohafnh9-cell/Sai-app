import type { AttackPlan } from "../../types";
import type { DiscoveryReport } from "../../discovery/types";
import type { BusinessLogicTeamContext } from "./discovery.types";
import { discoverBusinessWorkflows } from "./workflow-discovery";

export function buildBusinessLogicTeamContext(input: {
  businessLogicTeamRunId: string;
  redTeamRunId: string;
  organizationId: string;
  projectId: string;
  commitSha?: string | null;
  discovery: DiscoveryReport;
  plan: AttackPlan;
}): BusinessLogicTeamContext {
  const discoveryResult = discoverBusinessWorkflows(input.discovery);
  return {
    businessLogicTeamRunId: input.businessLogicTeamRunId,
    redTeamRunId: input.redTeamRunId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    commitSha: input.commitSha ?? input.discovery.commitSha ?? null,
    discovery: input.discovery,
    plan: input.plan,
    signals: discoveryResult.signals,
    entities: discoveryResult.entities,
    workflows: discoveryResult.workflows,
  };
}

export { discoverBusinessWorkflows } from "./workflow-discovery";
export { discoverBusinessEntities } from "./entity-discovery";
export { analyzeBusinessDiscoverySignals } from "./signals";

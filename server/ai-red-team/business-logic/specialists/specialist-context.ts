import type { BusinessLogicTeamContext } from "../discovery/discovery.types";
import type { BusinessLogicSpecialistContext } from "./specialist.types";

export function buildBusinessLogicSpecialistContext(
  teamContext: BusinessLogicTeamContext
): BusinessLogicSpecialistContext | null {
  if (!teamContext.domainModel) return null;

  return {
    businessLogicTeamRunId: teamContext.businessLogicTeamRunId,
    redTeamRunId: teamContext.redTeamRunId,
    organizationId: teamContext.organizationId,
    projectId: teamContext.projectId,
    discovery: teamContext.discovery,
    signals: teamContext.signals,
    discoveredWorkflows: teamContext.workflows,
    domain: teamContext.domainModel,
  };
}

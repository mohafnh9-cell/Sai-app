import type { SecurityDecisionReport } from "./decision-model";

export type ProjectSecurityDecisionSnapshot = {
  projectId: string;
  organizationId?: string | null;
  commitSha: string | null;
  report: SecurityDecisionReport;
  recordedAt: string;
};

export class InMemoryProjectDecisionStore {
  private latestByProject = new Map<string, ProjectSecurityDecisionSnapshot>();

  set(snapshot: ProjectSecurityDecisionSnapshot): void {
    this.latestByProject.set(snapshot.projectId, snapshot);
  }

  getLatest(
    projectId: string,
    options?: { organizationId?: string | null }
  ): ProjectSecurityDecisionSnapshot | null {
    const snapshot = this.latestByProject.get(projectId) ?? null;
    if (!snapshot) return null;
    if (
      options?.organizationId &&
      snapshot.organizationId &&
      snapshot.organizationId !== options.organizationId
    ) {
      return null;
    }
    return snapshot;
  }
}

export const globalProjectDecisionStore = new InMemoryProjectDecisionStore();

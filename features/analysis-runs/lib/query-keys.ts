/**
 * React Query key factory for analysis-run scoped client caches.
 * `runId` maps to `scans.id`.
 */
export const analysisRunKeys = {
  all: ["analysis-run"] as const,
  project: (projectId: string) => [...analysisRunKeys.all, projectId] as const,
  run: (projectId: string, runId: string) =>
    [...analysisRunKeys.project(projectId), runId] as const,
  missionControl: (projectId: string, runId?: string | null) =>
    runId
      ? ([...analysisRunKeys.run(projectId, runId), "mission-control"] as const)
      : ([...analysisRunKeys.project(projectId), "mission-control"] as const),
  attackCenter: (projectId: string, runId?: string | null) =>
    runId
      ? ([...analysisRunKeys.run(projectId, runId), "attack-center"] as const)
      : ([...analysisRunKeys.project(projectId), "attack-center"] as const),
};

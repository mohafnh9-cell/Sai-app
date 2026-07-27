export type CoreRedTeamMetadata = {
  teamId: string;
  analysisPhase: string;
  executionMode: string;
  runId: string;
  generatedAt: string;
};

export type CoreVersionedArtifact = {
  schemaVersion: string;
  id: string;
  createdAt: string;
};

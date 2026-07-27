export type CoreExecutionPhase = {
  id: string;
  label: string;
  order: number;
  capabilityIds: string[];
};

export type CoreExecutionPipeline = {
  id: string;
  phases: CoreExecutionPhase[];
  metadata?: Record<string, unknown>;
};

export type CoreExecutionCoordinatorContract = {
  run(pipeline: CoreExecutionPipeline, context: Record<string, unknown>): Promise<{ status: string }>;
};

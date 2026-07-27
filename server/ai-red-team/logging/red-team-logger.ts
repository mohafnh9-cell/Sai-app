export type RedTeamLogEvent =
  | "director_started"
  | "planning_started"
  | "planning_completed"
  | "agents_selected"
  | "agent_started"
  | "agent_finished"
  | "orchestration_completed"
  | "director_completed"
  | "director_error"
  | "agent_error"
  | "orchestration_cancelled";

export type RedTeamLogEntry = {
  component: "ai-red-team";
  event: RedTeamLogEvent;
  timestamp: string;
  requestId?: string;
  planId?: string;
  agentId?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type RedTeamLogger = {
  log: (entry: Omit<RedTeamLogEntry, "component" | "timestamp">) => void;
};

export function createRedTeamLogger(sink?: (entry: RedTeamLogEntry) => void): RedTeamLogger {
  const write =
    sink ??
    ((entry: RedTeamLogEntry) => {
      console.info(entry);
    });

  return {
    log(input) {
      write({
        component: "ai-red-team",
        timestamp: new Date().toISOString(),
        ...input,
      });
    },
  };
}

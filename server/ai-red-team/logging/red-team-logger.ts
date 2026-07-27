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
  | "orchestration_cancelled"
  | "autonomous_orchestrator_planned"
  | "intelligence_completed"
  | "decision_completed"
  | "production_verdict_completed"
  | "llm_team_completed"
  | "business_logic_team_completed"
  | "universal_engineering_completed"
  | "fix_strategy_completed"
  | "authorization_team_completed"
  | "api_team_completed"
  | "browser_team_completed"
  | "browser_team_failed"
  | "business_logic_metrics"
  | "business_logic_persist_started"
  | "business_logic_persist_completed"
  | "business_logic_persist_partial"
  | "business_logic_persist_failed";

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

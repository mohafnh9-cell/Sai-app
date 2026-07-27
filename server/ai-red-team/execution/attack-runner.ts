import { randomUUID } from "node:crypto";
import type { RedTeamAgent } from "../agents/base-agent";
import type { AgentExecutionInput } from "../agents/base-agent";
import type { AttackExecution, AttackResult } from "../types";
import type { RedTeamLogger } from "../logging/red-team-logger";

export type AttackRunnerOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  logger?: RedTeamLogger;
};

export type RunAgentInput = {
  requestId: string;
  planPhaseId: string;
  agent: RedTeamAgent;
  executionInput: AgentExecutionInput;
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 0;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

export class AttackRunner {
  constructor(private readonly options: AttackRunnerOptions = {}) {}

  async runAgent(input: RunAgentInput): Promise<{ execution: AttackExecution; result: AttackResult }> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const logger = this.options.logger;

    const executionId = randomUUID();
    let attempt = 0;
    let lastError: string | null = null;

    while (attempt <= maxRetries) {
      attempt += 1;
      const startedAt = Date.now();
      const execution: AttackExecution = {
        executionId,
        agentId: input.agent.id,
        planPhaseId: input.planPhaseId,
        status: "running",
        attempt,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: null,
        durationMs: null,
        result: null,
        error: null,
      };

      logger?.log({
        event: "agent_started",
        requestId: input.requestId,
        agentId: input.agent.id,
        metadata: { planPhaseId: input.planPhaseId, attempt },
      });

      if (input.signal?.aborted) {
        const cancelled = this.buildCancelledResult(input, startedAt);
        execution.status = "cancelled";
        execution.finishedAt = cancelled.finishedAt;
        execution.durationMs = cancelled.durationMs;
        execution.result = cancelled;
        return { execution, result: cancelled };
      }

      try {
        const result = await this.runWithTimeout(
          () => input.agent.execute({ ...input.executionInput, signal: input.signal }),
          timeoutMs,
          input.signal
        );
        const finishedAt = Date.now();
        execution.status = result.status === "failed" ? "failed" : "completed";
        execution.finishedAt = new Date(finishedAt).toISOString();
        execution.durationMs = finishedAt - startedAt;
        execution.result = result;

        logger?.log({
          event: "agent_finished",
          requestId: input.requestId,
          agentId: input.agent.id,
          durationMs: execution.durationMs,
          metadata: { status: result.status, planPhaseId: input.planPhaseId },
        });

        if (result.status !== "failed" || attempt > maxRetries) {
          return { execution, result };
        }
        lastError = result.error ?? "Agent returned failed status";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isAbort = error instanceof DOMException && error.name === "AbortError";
        const finishedAt = Date.now();

        if (isAbort) {
          const cancelled = this.buildCancelledResult(input, startedAt);
          execution.status = "cancelled";
          execution.finishedAt = cancelled.finishedAt;
          execution.durationMs = cancelled.durationMs;
          execution.result = cancelled;
          logger?.log({
            event: "orchestration_cancelled",
            requestId: input.requestId,
            agentId: input.agent.id,
          });
          return { execution, result: cancelled };
        }

        const isTimeout = message.includes("timeout");
        lastError = message;
        logger?.log({
          event: "agent_error",
          requestId: input.requestId,
          agentId: input.agent.id,
          error: message,
          metadata: { attempt, timedOut: isTimeout },
        });

        if (isTimeout) {
          const timedOut = this.buildTimedOutResult(input, startedAt, message);
          execution.status = "timed_out";
          execution.finishedAt = timedOut.finishedAt;
          execution.durationMs = timedOut.durationMs;
          execution.result = timedOut;
          execution.error = message;
          if (attempt > maxRetries) return { execution, result: timedOut };
        } else if (attempt > maxRetries) {
          const failed = this.buildFailedResult(input, startedAt, message);
          execution.status = "failed";
          execution.finishedAt = failed.finishedAt;
          execution.durationMs = failed.durationMs;
          execution.result = failed;
          execution.error = message;
          return { execution, result: failed };
        }

        await sleep(Math.min(250 * attempt, 1_000), input.signal);
      }
    }

    const failed = this.buildFailedResult(
      input,
      Date.now(),
      lastError ?? "Agent execution failed"
    );
    return {
      execution: {
        executionId,
        agentId: input.agent.id,
        planPhaseId: input.planPhaseId,
        status: "failed",
        attempt,
        startedAt: failed.startedAt,
        finishedAt: failed.finishedAt,
        durationMs: failed.durationMs,
        result: failed,
        error: failed.error ?? null,
      },
      result: failed,
    };
  }

  private async runWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Agent execution timeout after ${timeoutMs}ms`)), timeoutMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      fn()
        .then((value) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        });
    });
  }

  private buildCancelledResult(input: RunAgentInput, startedAt: number): AttackResult {
    const finishedAt = Date.now();
    return {
      agentId: input.agent.id,
      agentName: input.agent.name,
      domain: input.executionInput.domain,
      status: "cancelled",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      findings: [],
      evidence: [],
      logs: [`[${input.agent.id}] cancelled`],
    };
  }

  private buildTimedOutResult(
    input: RunAgentInput,
    startedAt: number,
    message: string
  ): AttackResult {
    const finishedAt = Date.now();
    return {
      agentId: input.agent.id,
      agentName: input.agent.name,
      domain: input.executionInput.domain,
      status: "timed_out",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      findings: [],
      evidence: [],
      logs: [`[${input.agent.id}] timed out`],
      error: message,
    };
  }

  private buildFailedResult(
    input: RunAgentInput,
    startedAt: number,
    message: string
  ): AttackResult {
    const finishedAt = Date.now();
    return {
      agentId: input.agent.id,
      agentName: input.agent.name,
      domain: input.executionInput.domain,
      status: "failed",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      findings: [],
      evidence: [],
      logs: [`[${input.agent.id}] failed`],
      error: message,
    };
  }
}

export function createAttackRunner(options?: AttackRunnerOptions): AttackRunner {
  return new AttackRunner(options);
}

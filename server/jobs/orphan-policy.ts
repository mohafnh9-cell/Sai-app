import { getScanJobHeartbeatStaleMs } from "./scan-job-heartbeat";

/**
 * When may a scan job whose SCAN already finished be treated as abandoned?
 *
 * A scan is marked `completed` well before its job is done: the platform stage (static red team, orchestration) and the
 * external engines run afterwards, inside the same job. So "scan completed + job still running" is the NORMAL state of a healthy
 * job for several seconds and must never, by itself, make a read (Mission Control, Journey, a status poll) complete the job
 * or settle its verdict. Only a verifiable absence of activity does.
 *
 * Signals of activity, newest wins: heartbeat, start, last update, last execution trace. A job is abandoned when the newest
 * one is older than the heartbeat stale window (`getScanJobHeartbeatStaleMs`, the same window the recovery cron uses to find
 * stuck jobs) or its execution deadline has passed. A job with NO signal at all cannot prove it is alive, so it is abandoned.
 */
export type ScanJobActivityFields = {
  status?: string | null;
  heartbeat_at?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  scheduled_at?: string | null;
  execution_deadline_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AbandonmentVerdict =
  | { abandoned: false; reason: "recent_activity"; lastActivityAt: string }
  | { abandoned: true; reason: "no_activity_signal" | "stale" | "deadline_exceeded"; lastActivityAt: string | null };

function parseMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function scanJobLastActivityMs(job: ScanJobActivityFields): number | null {
  const trace = (job.metadata as { lastTraceAt?: unknown } | null | undefined)?.lastTraceAt;
  const candidates = [
    parseMs(job.heartbeat_at),
    parseMs(job.started_at),
    parseMs(job.updated_at),
    parseMs(trace),
    // a queued job has not started: its schedule time is its only activity
    job.status === "queued" ? parseMs(job.scheduled_at) : null,
  ].filter((value): value is number => value !== null);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

export function assessScanJobAbandonment(job: ScanJobActivityFields, nowMs: number = Date.now()): AbandonmentVerdict {
  const last = scanJobLastActivityMs(job);
  const deadline = parseMs(job.execution_deadline_at);
  if (last === null) return { abandoned: true, reason: "no_activity_signal", lastActivityAt: null };
  const lastActivityAt = new Date(last).toISOString();
  if (deadline !== null && nowMs > deadline) return { abandoned: true, reason: "deadline_exceeded", lastActivityAt };
  if (nowMs - last > getScanJobHeartbeatStaleMs()) return { abandoned: true, reason: "stale", lastActivityAt };
  return { abandoned: false, reason: "recent_activity", lastActivityAt };
}

export function isScanJobAbandoned(job: ScanJobActivityFields, nowMs: number = Date.now()): boolean {
  return assessScanJobAbandonment(job, nowMs).abandoned;
}

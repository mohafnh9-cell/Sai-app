import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { touchScanJobHeartbeat } from "./scan-job-store";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;
const MIN_HEARTBEAT_INTERVAL_MS = 15_000;

export function getScanJobHeartbeatIntervalMs(): number {
  const raw = Number(process.env.SCAN_JOB_HEARTBEAT_INTERVAL_MS ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw < MIN_HEARTBEAT_INTERVAL_MS) {
    return DEFAULT_HEARTBEAT_INTERVAL_MS;
  }
  return raw;
}

/** Running jobs without a fresh heartbeat are treated as lost workers. */
export function getScanJobHeartbeatStaleMs(): number {
  return getScanJobHeartbeatIntervalMs() * 2 + 30_000;
}

export function startScanJobHeartbeat(
  admin: SupabaseClient,
  scanJobId: string
): () => void {
  const intervalMs = getScanJobHeartbeatIntervalMs();
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    void touchScanJobHeartbeat(admin, scanJobId).catch(() => undefined);
  }, intervalMs);

  if (typeof timer === "object" && "unref" in timer) {
    (timer as NodeJS.Timeout).unref();
  }

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

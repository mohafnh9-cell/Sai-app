import type { FailureEventPayload } from "inngest";

/** Original trigger event is nested under the internal function-failed payload. */
export function scanJobIdFromInngestFailure(
  failureEvent: FailureEventPayload
): string | undefined {
  const trigger = failureEvent.data?.event;
  if (!trigger || typeof trigger !== "object" || !("data" in trigger)) {
    return undefined;
  }
  const data = trigger.data;
  if (!data || typeof data !== "object" || !("scanJobId" in data)) {
    return undefined;
  }
  const scanJobId = (data as { scanJobId?: unknown }).scanJobId;
  return typeof scanJobId === "string" && scanJobId.length > 0 ? scanJobId : undefined;
}

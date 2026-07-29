import { getScanSchedulerMode } from "./scan-scheduler";

export const INNGEST_NOT_CONFIGURED = "INNGEST_NOT_CONFIGURED";

export type InngestConfigStatus =
  | { ok: true; eventKeyPresent: boolean; signingKeyPresent: boolean }
  | {
      ok: false;
      code: typeof INNGEST_NOT_CONFIGURED | "INGEST_NOT_CONFIGURED";
      message: string;
      missing: string[];
    };

export function getInngestConfigStatus(): InngestConfigStatus {
  const eventKeyPresent = Boolean(process.env.INNGEST_EVENT_KEY?.trim());
  const signingKeyPresent = Boolean(process.env.INNGEST_SIGNING_KEY?.trim());
  const missing: string[] = [];
  if (!eventKeyPresent) missing.push("INNGEST_EVENT_KEY");
  if (!signingKeyPresent) missing.push("INNGEST_SIGNING_KEY");

  if (missing.length === 0) {
    return { ok: true, eventKeyPresent, signingKeyPresent };
  }

  return {
    ok: false,
    code: INNGEST_NOT_CONFIGURED,
    message:
      "Inngest is not configured for this environment. Set INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY in Vercel.",
    missing,
  };
}

export function assertInngestReadyForScanDispatch(): void {
  if (getScanSchedulerMode() !== "inngest") return;

  const status = getInngestConfigStatus();
  if (!status.ok) {
    throw new Error(status.message);
  }
}

export function mapInngestPlanErrorCode(code: string): string {
  if (code === "INGEST_NOT_CONFIGURED") return INNGEST_NOT_CONFIGURED;
  return code;
}

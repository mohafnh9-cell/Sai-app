import type { VerdictStatus } from "@/brain/production-verdict/schema";
import type { Translator } from "./types";

/**
 * Status-keyed verdict copy. `ready_to_ship` is the only status whose copy is
 * an affirmative deployment claim, so it is gated: affirmative copy is used
 * ONLY when the caller passes `affirms === true`, i.e. the canonical evidence
 * policy (`verdictAffirmsDeploy`) allowed it. Callers that only know the status
 * (lists, history points) get the conservative "evidence limited" copy -- the
 * UI never reinterprets `ready_to_ship` on its own.
 */
function copyKey(status: VerdictStatus, affirms?: boolean | null): string {
  return status === "ready_to_ship" && affirms !== true ? "ready_evidence_limited" : status;
}

export function verdictStatusLabel(status: VerdictStatus, t: Translator, affirms?: boolean | null): string {
  return t(`verdict.status.${copyKey(status, affirms)}.label`);
}

export function verdictStatusHeadline(status: VerdictStatus, t: Translator, affirms?: boolean | null): string {
  return t(`verdict.status.${copyKey(status, affirms)}.headline`);
}

export function verdictStatusDescription(status: VerdictStatus, t: Translator, affirms?: boolean | null): string {
  return t(`verdict.status.${copyKey(status, affirms)}.description`);
}

export function verdictStatusMessage(status: VerdictStatus, t: Translator, affirms?: boolean | null): string {
  return t(`verdict.status.${copyKey(status, affirms)}.message`);
}

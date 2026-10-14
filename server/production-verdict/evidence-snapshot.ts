import { createHash } from "node:crypto";

/**
 * The evidence a verdict is computed from, captured BY THE GENERATOR from the rows it actually read, and tied to the verdict by a
 * digest that travels inside the verdict row itself (`verdict.evidenceDigest`, inserted atomically with it). The record in
 * `scans.metrics.verdictEvidence` repeats the snapshot fields and the digest, so "this record is the evidence of this verdict" is
 * something that can be CHECKED (recompute the digest from the stored fields, compare with the verdict's), not something inferred from
 * which writer happened to be first.
 *
 * Nothing here changes a verdict's content. A failed read never becomes "no engines" or "no findings": it is carried as an explicit
 * `unavailable` and the verdict is computed as partial by the caller.
 */

export type EngineEvidence = { engine: string; status: string };

export type EvidenceSnapshot = {
  /** Latest job per engine, exactly as the coverage check judged it; "not_run" = no external engine was planned; "unavailable" = unreadable. */
  externalEngines: EngineEvidence[] | "not_run" | "unavailable";
  /** The external findings that went into the verdict (after correlation suppression), or "unavailable" when they could not be read. */
  externalFindings: { count: number; idsDigest: string } | "unavailable";
  securityDecisionId: string | null;
  securityDecisionIncluded: boolean;
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Order-independent digest of a set of finding ids. */
export function digestIds(ids: readonly string[]): string {
  return sha256(JSON.stringify([...new Set(ids)].sort()));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function evidenceDigest(snapshot: EvidenceSnapshot): string {
  const engines =
    Array.isArray(snapshot.externalEngines)
      ? [...snapshot.externalEngines].sort((a, b) => (a.engine < b.engine ? -1 : a.engine > b.engine ? 1 : 0))
      : snapshot.externalEngines;
  return sha256(canonical({ v: 1, ...snapshot, externalEngines: engines }));
}

/** Which of the verdict's inputs could not be established: those make a verdict partial, never clean. */
export function snapshotHasGaps(snapshot: EvidenceSnapshot): boolean {
  return snapshot.externalEngines === "unavailable" || snapshot.externalFindings === "unavailable";
}

/** Decision id of a security decision report / stored decision, or null. */
export function decisionIdOf(value: unknown): string | null {
  const id = (value as { decision?: { decisionId?: unknown } } | null | undefined)?.decision?.decisionId;
  return typeof id === "string" ? id : null;
}

export type EvidenceBinding =
  | "verified_capture" // captured by the generator, digest in the verdict equals the digest of the stored snapshot
  | "reconstruction_unverifiable" // written afterwards: cannot be shown to be what the generator used
  | "digest_mismatch" // a capture exists but is not the one this verdict carries (another generator's snapshot, or tampering)
  | "verdict_without_digest" // the verdict does not claim a trace (persisting the snapshot failed, or an older verdict)
  | "no_record";

/**
 * Pure check used by readers (and by the acceptance queries): may this verdict claim traceability to this record?
 * Only `verified_capture` may. Everything else must be shown as "not traceable", never as "no engines" or "nothing found".
 */
export function checkEvidenceBinding(
  verdict: { evidenceDigest?: string | null } | null | undefined,
  record: unknown
): EvidenceBinding {
  if (!record || typeof record !== "object") return "no_record";
  const rec = record as Record<string, unknown>;
  if (rec.capture === "reconstructed_after_verdict") return "reconstruction_unverifiable";
  const claimed = verdict?.evidenceDigest;
  if (!claimed) return "verdict_without_digest";
  const snapshot = rec.snapshot as EvidenceSnapshot | undefined;
  if (rec.capture !== "at_verdict_generation" || !snapshot) return "digest_mismatch";
  return rec.evidenceDigest === claimed && evidenceDigest(snapshot) === claimed ? "verified_capture" : "digest_mismatch";
}

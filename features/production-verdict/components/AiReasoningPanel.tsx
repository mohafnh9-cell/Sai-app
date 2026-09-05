"use client";

import { useEffect, useState } from "react";

type ReasoningEntry = {
  findingId: string;
  exploitability: "confirmed" | "likely_exploitable" | "uncertain" | "likely_false_positive";
  confidence: "high" | "medium" | "low";
  reasoning: string;
};

type AttackChainEntry = {
  findingIds: string[];
  severity: "critical" | "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  explanation: string;
};

type AiReasoningOverlayResponse = {
  status: "pending" | "completed" | "failed" | "skipped";
  findings: ReasoningEntry[];
  attack_chains: AttackChainEntry[];
} | null;

const EXPLOITABILITY_LABEL: Record<ReasoningEntry["exploitability"], string> = {
  confirmed: "Likely confirmed by AI review",
  likely_exploitable: "AI assessment: likely exploitable",
  uncertain: "AI assessment: uncertain",
  likely_false_positive: "AI assessment: possible false positive",
};

/**
 * Phase 30 -- read-only display of the selective AI reasoning overlay for a
 * scan's Category C findings. Renders nothing when there is no overlay, it
 * hasn't completed, or it produced no interpretations -- this is additive,
 * non-authoritative context, never a replacement for the deterministic
 * finding list or the Production Verdict shown elsewhere on this page.
 */
export function AiReasoningPanel({ scanId }: { scanId: string }) {
  const [overlay, setOverlay] = useState<AiReasoningOverlayResponse>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/scans/${scanId}/ai-reasoning`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setOverlay(data?.aiReasoning ?? null);
      })
      .catch(() => {
        if (!cancelled) setOverlay(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  if (!overlay || overlay.status !== "completed") return null;
  const findings = overlay.findings ?? [];
  const chains = overlay.attack_chains ?? [];
  if (findings.length === 0 && chains.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        AI Interpretation
      </p>
      <p className="text-xs text-muted-foreground/80">
        These are AI-generated interpretations of findings already detected by the deterministic
        scanner — not new vulnerabilities, and never a security verdict on their own.
      </p>

      {findings.length > 0 ? (
        <ul className="space-y-2">
          {findings.map((entry) => (
            <li key={entry.findingId} className="text-sm text-foreground/90">
              <span className="font-medium">{EXPLOITABILITY_LABEL[entry.exploitability]}</span>
              <span className="text-muted-foreground"> (confidence: {entry.confidence})</span>
              <p className="text-xs text-muted-foreground">{entry.reasoning}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {chains.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Possible attack chains</p>
          <ul className="space-y-2">
            {chains.map((chain, index) => (
              <li key={index} className="text-sm text-foreground/90">
                <span className="font-medium">
                  {chain.findingIds.length}-step chain ({chain.severity} severity, {chain.confidence}{" "}
                  confidence)
                </span>
                <p className="text-xs text-muted-foreground">{chain.explanation}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

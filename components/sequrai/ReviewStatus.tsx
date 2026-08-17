"use client";

import { ScanStatusIndicator, type ScanPhase } from "./ScanStatusIndicator";
import { cn } from "@/lib/utils";

export type ReviewPhase = ScanPhase | "analyzing" | "verifying";

type ReviewStatusProps = {
  phase: ReviewPhase;
  progress?: number | null;
  message?: string | null;
  className?: string;
};

const PHASE_LABEL: Record<ReviewPhase, string> = {
  idle: "Ready",
  queued: "Queued",
  running: "Scanning",
  analyzing: "Analyzing",
  verifying: "Verifying",
  completed: "Complete",
  failed: "Failed",
};

function mapPhase(phase: ReviewPhase): ScanPhase {
  if (phase === "analyzing" || phase === "verifying") return "running";
  return phase;
}

export function ReviewStatus({ phase, progress, message, className }: ReviewStatusProps) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-label-caps">{PHASE_LABEL[phase]}</p>
      <ScanStatusIndicator phase={mapPhase(phase)} progress={progress} message={message ?? undefined} />
    </div>
  );
}

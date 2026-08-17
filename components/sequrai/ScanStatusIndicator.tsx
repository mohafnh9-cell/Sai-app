"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ScanPhase = "idle" | "queued" | "running" | "completed" | "failed";

type ScanStatusIndicatorProps = {
  phase: ScanPhase;
  progress?: number | null;
  message?: string | null;
  className?: string;
};

const phaseTone: Record<ScanPhase, string> = {
  idle: "bg-muted-foreground/40",
  queued: "bg-warning/80",
  running: "bg-primary animate-pulse",
  completed: "bg-success",
  failed: "bg-danger",
};

export function ScanStatusIndicator({
  phase,
  progress,
  message,
  className,
}: ScanStatusIndicatorProps) {
  const showProgress = phase === "running" && progress != null;

  return (
    <div className={cn("flex items-center gap-3 text-sm", className)} role="status">
      {phase === "running" ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" aria-hidden />
      ) : (
        <span
          className={cn("h-2 w-2 rounded-full shrink-0", phaseTone[phase])}
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        {message ? <p className="text-muted-foreground truncate">{message}</p> : null}
        {showProgress ? (
          <div className="mt-1.5 h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary seq-transition"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import type { DiffContext as DiffContextType } from "@/features/security-analysis/git-diff/types";
import type { ScanFinding } from "@/features/security-scanner/components/types";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export function findingDiffContext(finding: ScanFinding): DiffContextType | null {
  const raw = finding.metadata?.diffContext;
  if (!raw || typeof raw !== "object") return null;
  const status = (raw as { status?: unknown }).status;
  if (typeof status !== "string") return null;
  return raw as DiffContextType;
}

const STATUS_CLASS: Record<string, string> = {
  introduced: "border-severity-high/30 bg-severity-high/5 text-severity-high",
  affected: "border-warning/30 bg-warning/5 text-warning",
  pre_existing: "border-border bg-muted/30 text-muted-foreground",
  unrelated: "border-border bg-muted/20 text-muted-foreground",
  unknown: "border-border bg-muted/20 text-muted-foreground",
};

type DiffContextProps = {
  context: DiffContextType | null;
  className?: string;
  compact?: boolean;
};

/** Visualizes git-diff relationship — never implies introduced without backend status. */
export function DiffContextBadge({ context, className, compact }: DiffContextProps) {
  const { t } = useI18n("technicalDetails");

  if (!context) return null;

  const label =
    t(`diffContext.${context.status}` as "diffContext.introduced") ??
    t("diffContext.unknown");
  const tone = STATUS_CLASS[context.status] ?? STATUS_CLASS.unknown;

  return (
    <div className={cn("inline-flex flex-col gap-1", className)}>
      <span className={cn("inline-flex rounded-full border px-1.5 py-0 text-[10px] font-medium", tone)}>
        {label}
      </span>
      {!compact && context.hunkContext ? (
        <p className="text-xs text-muted-foreground font-mono truncate max-w-md">{context.hunkContext}</p>
      ) : null}
    </div>
  );
}

type DiffContextPanelProps = {
  context: DiffContextType | null;
  snippet?: string | null;
  filePath?: string | null;
  line?: number | null;
  className?: string;
};

export function DiffContextPanel({
  context,
  snippet,
  filePath,
  line,
  className,
}: DiffContextPanelProps) {
  const { t } = useI18n("technicalDetails");

  if (!context) {
    return (
      <div className={cn("rounded-lg border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground", className)}>
        {t("diffContext.unavailable")}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <DiffContextBadge context={context} />
      {filePath ? (
        <p className="text-xs text-muted-foreground font-mono">
          {filePath}
          {line != null ? `:${line}` : ""}
        </p>
      ) : null}
      {snippet ? (
        <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/30 p-3 text-xs font-mono">
          <code>{snippet}</code>
        </pre>
      ) : null}
    </div>
  );
}

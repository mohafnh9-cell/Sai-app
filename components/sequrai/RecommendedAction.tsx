import { cn } from "@/lib/utils";
import { radius } from "@/lib/design-system/tokens";

type RecommendedActionProps = {
  eyebrow?: string;
  title: string;
  description?: string | null;
  action?: React.ReactNode;
  className?: string;
};

/** Single prioritized next step — used under Production Verdict. */
export function RecommendedAction({
  eyebrow,
  title,
  description,
  action,
  className,
}: RecommendedActionProps) {
  return (
    <div className={cn("pt-6 border-t border-border/40 space-y-3", className)}>
      {eyebrow ? <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p> : null}
      <p className="text-lg font-medium leading-snug">{title}</p>
      {description ? (
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

type SeverityCountGridProps = {
  counts: { critical: number; high: number; medium: number; low?: number };
  labels: { critical: string; high: string; medium: string; low?: string };
  className?: string;
};

export function SeverityCountGrid({ counts, labels, className }: SeverityCountGridProps) {
  const items = [
    { key: "critical", value: counts.critical, label: labels.critical, tone: "text-severity-critical" },
    { key: "high", value: counts.high, label: labels.high, tone: "text-severity-high" },
    { key: "medium", value: counts.medium, label: labels.medium, tone: "text-severity-medium" },
  ] as const;

  return (
    <div className={cn("grid grid-cols-3 gap-4", className)}>
      {items.map((item) => (
        <div key={item.key} className={cn(radius.md, "border border-border/50 px-4 py-3")}>
          <p className="text-label-caps">{item.label}</p>
          <p className={cn("mt-1 text-2xl font-semibold tabular-nums", item.tone)}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

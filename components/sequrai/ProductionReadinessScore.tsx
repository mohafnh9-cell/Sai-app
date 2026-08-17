import { cn } from "@/lib/utils";
import { shouldShowScore } from "@/brain/production-verdict/status-ui";
import type { VerdictStatus } from "@/brain/production-verdict/schema";

type ProductionReadinessScoreProps = {
  score: number | null;
  status: VerdictStatus;
  label?: string;
  className?: string;
};

/** Large readiness score — decision weight, not a dashboard metric. */
export function ProductionReadinessScore({
  score,
  status,
  label,
  className,
}: ProductionReadinessScoreProps) {
  if (!shouldShowScore(score, status) || score == null) return null;

  return (
    <div className={cn(className)}>
      <p className="text-display-score">{score}</p>
      {label ? (
        <p className="mt-2 text-label-caps">{label}</p>
      ) : null}
    </div>
  );
}

import { cn } from "@/lib/utils";
import { shouldShowScore } from "@/brain/production-verdict/status-ui";
import type { VerdictStatus } from "@/brain/production-verdict/schema";

type ProductionReadinessScoreProps = {
  score: number | null;
  status: VerdictStatus;
  label?: string;
  /**
   * "primary" is the large standalone display size. "secondary" is for use
   * beside/below a verdict headline, where the verdict must stay the
   * dominant element and the score is supporting data.
   */
  size?: "primary" | "secondary";
  className?: string;
};

/** Readiness score — supporting data. Never render this larger than the verdict it belongs to. */
export function ProductionReadinessScore({
  score,
  status,
  label,
  size = "primary",
  className,
}: ProductionReadinessScoreProps) {
  if (!shouldShowScore(score, status) || score == null) return null;

  return (
    <div className={cn(className)}>
      <p
        className={
          size === "secondary"
            ? "text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight leading-none"
            : "text-display-score"
        }
      >
        {score}
      </p>
      {label ? (
        <p className="mt-2 text-label-caps">{label}</p>
      ) : null}
    </div>
  );
}

import { cn } from "@/lib/utils";

type SkeletonBlockProps = {
  className?: string;
  lines?: number;
};

export function SkeletonBlock({ className, lines = 1 }: SkeletonBlockProps) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "h-4 animate-pulse rounded-md bg-muted/60",
            index === lines - 1 && lines > 1 ? "w-4/5" : "w-full"
          )}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-2xl border border-border/60 p-6 space-y-4", className)}
      aria-busy="true"
      aria-label="Loading"
    >
      <SkeletonBlock lines={1} className="max-w-[40%]" />
      <SkeletonBlock lines={3} />
    </div>
  );
}

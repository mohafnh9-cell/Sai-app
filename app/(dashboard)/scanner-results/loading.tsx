export default function ScannerResultsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-8 py-8 sm:py-12 space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-muted/60" />
        <div className="h-4 w-72 rounded bg-muted/40" />
      </div>
      <div className="space-y-1">
        <div className="h-[76px] rounded-xl border border-border/50 bg-muted/20" />
        <div className="h-[76px] rounded-xl border border-border/50 bg-muted/20" />
        <div className="h-[76px] rounded-xl border border-border/50 bg-muted/20" />
        <div className="h-[76px] rounded-xl border border-border/50 bg-muted/20" />
      </div>
    </div>
  );
}

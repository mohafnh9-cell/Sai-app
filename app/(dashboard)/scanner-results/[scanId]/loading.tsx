export default function ScannerResultDetailLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-8 py-8 sm:py-12 space-y-8 animate-pulse">
      <div className="h-4 w-24 rounded bg-muted/40" />
      <div className="space-y-3">
        <div className="h-7 w-56 rounded bg-muted/60" />
        <div className="h-4 w-40 rounded bg-muted/40" />
      </div>
      <div className="h-40 rounded-xl border border-border/50 bg-muted/20" />
      <div className="h-64 rounded-xl border border-border/50 bg-muted/20" />
    </div>
  );
}

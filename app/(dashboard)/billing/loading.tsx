export default function BillingLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-8 py-8 sm:py-12 space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-24 rounded bg-muted/60" />
        <div className="h-4 w-64 rounded bg-muted/40" />
      </div>
      <div className="h-16 rounded-lg border border-border/50 bg-muted/20" />
      <div className="h-56 rounded-xl border border-border/50 bg-muted/20" />
    </div>
  );
}

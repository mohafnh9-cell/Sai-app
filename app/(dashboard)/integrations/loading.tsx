export default function IntegrationsLoading() {
  return (
    <div className="p-6 space-y-6 max-w-4xl animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-muted/60" />
        <div className="h-4 w-72 rounded bg-muted/40" />
      </div>
      <div className="h-28 rounded-xl bg-muted/30" />
      <div className="h-28 rounded-xl bg-muted/30" />
    </div>
  );
}

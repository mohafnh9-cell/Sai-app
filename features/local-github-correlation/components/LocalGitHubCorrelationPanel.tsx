"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { LocalGitHubCorrelationSummary } from "@/lib/correlation/types";

type Props = {
  projectId: string;
};

const STATUS_LABEL: Record<string, string> = {
  matched: "Matched on GitHub",
  unmatched: "Not correlated",
  resolved: "Resolved on GitHub",
  changed: "Changed on GitHub",
  ambiguous: "Ambiguous",
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case "matched":
      return "text-emerald-400 border-emerald-400/30 bg-emerald-400/10";
    case "resolved":
      return "text-sky-400 border-sky-400/30 bg-sky-400/10";
    case "changed":
      return "text-amber-500 border-amber-500/30 bg-amber-500/10";
    case "ambiguous":
      return "text-orange-500 border-orange-500/30 bg-orange-500/10";
    default:
      return "text-muted-foreground";
  }
}

export function LocalGitHubCorrelationPanel({ projectId }: Props) {
  const [payload, setPayload] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LocalGitHubCorrelationSummary | null>(null);

  const placeholder = useMemo(
    () =>
      JSON.stringify(
        {
          commitSha: "abc123def456",
          branch: "main",
          findings: [
            {
              ruleId: "secrets.exposed",
              filePath: "src/config.ts",
              line: 12,
              severity: "high",
              title: "Hardcoded secret detected",
              correlationKey: "optional-from-local-audit",
            },
          ],
        },
        null,
        2
      ),
    []
  );

  async function runCorrelation() {
    setLoading(true);
    setError(null);
    try {
      const parsed = JSON.parse(payload) as {
        commitSha?: string | null;
        branch?: string | null;
        findings?: Array<Record<string, unknown>>;
      };
      const res = await fetch(`/api/projects/${projectId}/local-correlation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commitSha: parsed.commitSha ?? null,
          branch: parsed.branch ?? null,
          findings: parsed.findings ?? [],
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { correlation?: LocalGitHubCorrelationSummary; error?: string }
        | null;
      if (!res.ok || !data?.correlation) {
        throw new Error(data?.error ?? "Could not correlate local findings.");
      }
      setResult(data.correlation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON payload.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Local ↔ GitHub correlation</CardTitle>
        <CardDescription className="text-xs">
          Compare local MCP audit findings against persisted GitHub scan data. GitHub Production
          Verdict remains authoritative.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          placeholder={placeholder}
          className="min-h-[160px] font-mono text-xs"
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void runCorrelation()} disabled={loading || !payload.trim()}>
            {loading ? "Correlating…" : "Correlate with GitHub"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPayload(placeholder)}>
            Load example
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {result ? (
          <div className="space-y-3 rounded-lg border border-border/50 bg-secondary/20 p-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">LOCAL</Badge>
              <Badge variant="outline">GITHUB authoritative</Badge>
              {result.githubRepo ? (
                <span className="text-muted-foreground">{result.githubRepo}</span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Commit: {result.commit.status}
              {result.commit.reason ? ` — ${result.commit.reason}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              PR: {result.pullRequest.status}
              {result.pullRequest.pullRequestNumber
                ? ` — #${result.pullRequest.pullRequestNumber}`
                : ""}
              {result.pullRequest.reason ? ` — ${result.pullRequest.reason}` : ""}
            </p>
            {result.githubVerdictStatus ? (
              <p className="text-xs">
                GitHub Production Verdict:{" "}
                <span className="font-medium">{result.githubVerdictStatus}</span>
              </p>
            ) : null}
            <ul className="space-y-2">
              {result.findings.slice(0, 8).map((finding) => (
                <li
                  key={`${finding.correlationKey}:${finding.local.filePath}`}
                  className="rounded-md border border-border/40 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{finding.local.title ?? finding.local.ruleId}</span>
                    <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(finding.status)}`}>
                      {STATUS_LABEL[finding.status] ?? finding.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {finding.local.filePath}
                    {finding.local.line ? `:${finding.local.line}` : ""} · {finding.local.ruleId}
                  </p>
                  {finding.reason ? (
                    <p className="text-xs text-muted-foreground mt-1">{finding.reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            {result.findings.length > 8 ? (
              <p className="text-xs text-muted-foreground">
                Showing 8 of {result.findings.length} correlated findings.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

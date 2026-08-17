"use client";

import { useMemo, useState } from "react";
import { Search, ShieldAlert } from "lucide-react";
import { SecurityFindingCard } from "@/components/sequrai";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CollapsibleSection } from "@/components/shared/CollapsibleSection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trackEvent } from "@/lib/analytics/track";
import type { FixPromptContext } from "../fix-prompt-context";
import {
  findingFile,
  type ScanFinding,
} from "@/features/security-scanner/components/types";
import { useI18n } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/types";

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};
type FindingGroup = "blockers" | "warnings" | "improvements" | "informational";

function findingGroup(severity?: string): FindingGroup {
  const s = severity?.toUpperCase() ?? "";
  if (s === "CRITICAL" || s === "HIGH") return "blockers";
  if (s === "MEDIUM") return "warnings";
  if (s === "LOW") return "improvements";
  return "informational";
}

function groupLabel(group: FindingGroup, t: Translator) {
  switch (group) {
    case "blockers":
      return t("productionBlockers");
    case "warnings":
      return t("warnings");
    case "improvements":
      return t("improvements");
    case "informational":
      return t("informational");
  }
}

function unique(findings: ScanFinding[], value: (finding: ScanFinding) => unknown) {
  return Array.from(
    new Set(
      findings
        .map(value)
        .filter((item): item is string => typeof item === "string" && item.length > 0)
    )
  ).sort();
}

function FilterSelect({
  label,
  value,
  values,
  onChange,
  valueLabels,
  allLabel,
  filterByAria,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
  valueLabels?: Record<string, string>;
  allLabel: string;
  filterByAria: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={filterByAria} className="min-w-32">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {values.map((item) => (
          <SelectItem key={item} value={item}>
            {valueLabels?.[item] ?? item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TechnicalFindingsSection({
  findings,
  fixPromptContext,
}: {
  findings: ScanFinding[];
  fixPromptContext?: FixPromptContext;
}) {
  const { t } = useI18n("technicalDetails");
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [category, setCategory] = useState("all");
  const [file, setFile] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [sort, setSort] = useState("severity");

  const options = useMemo(
    () => ({
      severities: unique(findings, (item) => item.severity),
      categories: unique(findings, (item) => item.category),
      files: unique(findings, findingFile),
    }),
    [findings]
  );

  const visibleFindings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return findings
      .filter((finding) => {
        const g = findingGroup(finding.severity);
        const haystack = [
          finding.title,
          finding.description,
          finding.category,
          finding.rule_id,
          finding.rule,
          findingFile(finding),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return (
          (!normalizedQuery || haystack.includes(normalizedQuery)) &&
          (severity === "all" || finding.severity === severity) &&
          (category === "all" || finding.category === category) &&
          (file === "all" || findingFile(finding) === file) &&
          (groupFilter === "all" || g === groupFilter)
        );
      })
      .sort((a, b) => {
        if (sort === "file") return findingFile(a).localeCompare(findingFile(b));
        if (sort === "title") return (a.title ?? "").localeCompare(b.title ?? "");
        return (
          (SEVERITY_ORDER[a.severity?.toUpperCase() ?? ""] ?? 99) -
          (SEVERITY_ORDER[b.severity?.toUpperCase() ?? ""] ?? 99)
        );
      });
  }, [findings, query, severity, category, file, groupFilter, sort]);

  const grouped = useMemo(() => {
    const map = new Map<FindingGroup, ScanFinding[]>();
    for (const finding of visibleFindings) {
      const g = findingGroup(finding.severity);
      const list = map.get(g) ?? [];
      list.push(finding);
      map.set(g, list);
    }
    return (["blockers", "warnings", "improvements", "informational"] as FindingGroup[])
      .filter((g) => (map.get(g)?.length ?? 0) > 0)
      .map((g) => ({ group: g, items: map.get(g) ?? [] }));
  }, [visibleFindings]);

  return (
    <CollapsibleSection
      title={t("title")}
      description={t("sectionDescription", { count: findings.length })}
      defaultOpen={false}
      onToggle={(open) => {
        if (open) trackEvent("technical_findings_opened", { count: findings.length });
      }}
    >
      <div className="space-y-4">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="pl-9"
              aria-label={t("searchAriaLabel")}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label={t("group")}
              value={groupFilter}
              values={["blockers", "warnings", "improvements", "informational"]}
              valueLabels={{
                blockers: t("productionBlockers"),
                warnings: t("warnings"),
                improvements: t("improvements"),
                informational: t("informational"),
              }}
              allLabel={t("filterAll", { label: t("group").toLowerCase() })}
              filterByAria={t("filterByAria", { label: t("group") })}
              onChange={setGroupFilter}
            />
            <FilterSelect
              label={t("severity")}
              value={severity}
              values={options.severities}
              allLabel={t("filterAll", { label: t("severity").toLowerCase() })}
              filterByAria={t("filterByAria", { label: t("severity") })}
              onChange={setSeverity}
            />
            <FilterSelect
              label={t("category")}
              value={category}
              values={options.categories}
              allLabel={t("filterAll", { label: t("category").toLowerCase() })}
              filterByAria={t("filterByAria", { label: t("category") })}
              onChange={setCategory}
            />
            <FilterSelect
              label={t("file")}
              value={file}
              values={options.files}
              allLabel={t("filterAll", { label: t("file").toLowerCase() })}
              filterByAria={t("filterByAria", { label: t("file") })}
              onChange={setFile}
            />
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger aria-label={t("sort")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="severity">{t("sortBySeverity")}</SelectItem>
                <SelectItem value="file">{t("sortByFile")}</SelectItem>
                <SelectItem value="title">{t("sortByTitle")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {t("showingCount", { shown: visibleFindings.length, total: findings.length })}
        </p>

        {visibleFindings.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-10 text-center">
              <ShieldAlert className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="font-medium">
                {findings.length ? t("noFindingsFiltered") : t("noFindings")}
              </p>
            </CardContent>
          </Card>
        ) : (
          grouped.map(({ group, items }) => (
            <div key={group} className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">{groupLabel(group, t)}</h3>
              {items.map((finding, index) => (
                <SecurityFindingCard
                  key={finding.id ?? index}
                  finding={finding}
                  fixPromptContext={fixPromptContext}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </CollapsibleSection>
  );
}

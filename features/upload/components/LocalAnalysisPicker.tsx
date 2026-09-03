"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, FolderOpen, HardDrive, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";
import { checkLocalSelectionPreflight } from "@/lib/upload/local-preflight";
import { SOURCE_ANALYSIS_LIMITS, LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES } from "@/lib/upload/source-limits";

type Phase = "idle" | "selected" | "uploading" | "analyzing" | "success" | "error";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** True only in browsers that support the non-standard webkitdirectory folder picker (Chrome/Edge/Firefox; partial Safari). */
function supportsDirectoryPicker(): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("input");
  return "webkitdirectory" in probe;
}

export function LocalAnalysisPicker() {
  const { t } = useI18n("upload");
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [files, setFiles] = useState<File[]>([]);
  const [projectName, setProjectName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const supported = useMemo(() => supportsDirectoryPicker(), []);

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const rootFolderName = (files[0] as (File & { webkitRelativePath?: string }) | undefined)
    ?.webkitRelativePath?.split("/")[0];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;

    // Client preflight only -- an optimization, not a security boundary.
    // The server re-validates every one of these limits authoritatively
    // regardless of what happens here (see lib/upload/local-preflight.ts).
    const preflight = checkLocalSelectionPreflight(selected);
    if (!preflight.ok) {
      setFiles([]);
      setPhase("error");
      setErrorMessage(
        t(`local.preflight.${preflight.reason}`, {
          maxFiles: SOURCE_ANALYSIS_LIMITS.maxFiles,
          maxTotalMb: Math.round(LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES / (1024 * 1024)),
          maxFileMb: Math.round(SOURCE_ANALYSIS_LIMITS.maxFileBytes / (1024 * 1024)),
        })
      );
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setFiles(selected);
    setProjectName(rootFolderNameFromFiles(selected) ?? "Local project");
    setErrorMessage(null);
    setPhase("selected");
  };

  const reset = () => {
    setFiles([]);
    setErrorMessage(null);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  };

  const analyze = () => {
    if (files.length === 0) return;
    setPhase("uploading");
    setUploadProgress(0);
    setErrorMessage(null);

    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file, (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    }
    formData.append("projectName", projectName || "Local project");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/analyze");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const pct = Math.round((event.loaded / event.total) * 100);
      setUploadProgress(pct);
      if (pct >= 100) setPhase("analyzing");
    };

    xhr.onload = () => {
      let body: { projectId?: string; scanId?: string; error?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !body?.projectId) {
        setPhase("error");
        setErrorMessage(body?.error ?? t("errors.generic"));
        return;
      }
      setPhase("success");
      router.push(projectVerdictHref(body.projectId, body.scanId ? { run: body.scanId } : undefined));
    };

    xhr.onerror = () => {
      setPhase("error");
      setErrorMessage(t("errors.generic"));
    };

    xhr.send(formData);
  };

  const busy = phase === "uploading" || phase === "analyzing" || phase === "success";

  if (!supported) {
    return (
      <p className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        {t("local.unsupported")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center seq-transition",
          phase === "error" ? "border-danger/40 bg-danger/5" : "border-border/60 bg-transparent"
        )}
      >
        {phase === "idle" ? (
          <>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-muted/40">
              <FolderOpen className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm font-medium">{t("local.idle")}</p>
            <p className="text-xs text-muted-foreground">{t("local.hint")}</p>
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              {t("local.choose")}
            </Button>
            <input
              ref={inputRef}
              type="file"
              // @ts-expect-error -- non-standard attribute, feature-detected above
              webkitdirectory=""
              directory=""
              multiple
              className="sr-only"
              onChange={handleChange}
              aria-label={t("local.choose")}
            />
          </>
        ) : phase === "error" ? (
          <>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-danger/10">
              <AlertCircle className="h-5 w-5 text-danger" aria-hidden />
            </div>
            <p className="text-sm font-medium text-danger">{errorMessage}</p>
            <Button variant="outline" size="sm" onClick={reset}>
              {t("retry")}
            </Button>
          </>
        ) : (
          <div className="flex w-full max-w-sm items-center gap-3 text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/40">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
              ) : (
                <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{rootFolderName ?? projectName}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {t("local.fileCount", { count: files.length })} · {formatBytes(totalBytes)}
              </p>
            </div>
            {!busy ? (
              <button
                type="button"
                onClick={reset}
                className="shrink-0 text-muted-foreground hover:text-foreground seq-focus-ring rounded-sm"
                aria-label={t("removeFile")}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
        )}
      </div>

      {phase === "selected" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="local-project-name">{t("projectNameLabel")}</Label>
            <Input
              id="local-project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              maxLength={100}
            />
          </div>
          <Button className="w-full" onClick={analyze}>
            {t("analyzeCta")}
          </Button>
        </div>
      ) : null}

      {phase === "uploading" || phase === "analyzing" ? (
        <div className="space-y-1.5 text-center">
          <p className="text-sm font-medium" role="status">
            {phase === "uploading"
              ? `${t("uploading")}${uploadProgress != null ? ` ${uploadProgress}%` : ""}`
              : t("analyzing")}
          </p>
          {phase === "uploading" && uploadProgress != null ? (
            <div className="mx-auto h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary seq-transition"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("analyzingHint")}</p>
        </div>
      ) : null}

      {phase === "success" ? (
        <p className="text-center text-sm text-success" role="status">
          {t("successRedirecting")}
        </p>
      ) : null}
    </div>
  );
}

function rootFolderNameFromFiles(files: File[]): string | undefined {
  const first = files[0] as (File & { webkitRelativePath?: string }) | undefined;
  return first?.webkitRelativePath?.split("/")[0];
}

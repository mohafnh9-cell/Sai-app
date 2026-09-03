"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, FileArchive, Loader2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;

type Phase = "idle" | "dragging" | "selected" | "uploading" | "analyzing" | "success" | "error";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadDropzone() {
  const { t } = useI18n("upload");
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndSetFile = useCallback(
    (candidate: File) => {
      if (!/\.zip$/i.test(candidate.name)) {
        setPhase("error");
        setErrorMessage(t("errors.not_zip"));
        return;
      }
      if (candidate.size > MAX_ARCHIVE_BYTES) {
        setPhase("error");
        setErrorMessage(t("errors.too_large"));
        return;
      }
      setFile(candidate);
      setProjectName(candidate.name.replace(/\.zip$/i, ""));
      setErrorMessage(null);
      setPhase("selected");
    },
    [t]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCounter.current = 0;
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) validateAndSetFile(dropped);
    },
    [validateAndSetFile]
  );

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current += 1;
    setPhase((prev) => (prev === "selected" ? prev : "dragging"));
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      setPhase((prev) => (prev === "dragging" ? "idle" : prev));
    }
  }, []);

  const handleBrowseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) validateAndSetFile(selected);
  };

  const reset = () => {
    setFile(null);
    setErrorMessage(null);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  };

  const analyze = () => {
    if (!file) return;
    setPhase("uploading");
    setUploadProgress(0);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("projectName", projectName || file.name.replace(/\.zip$/i, ""));

    // XMLHttpRequest (not fetch) specifically so upload.onprogress gives a
    // real, measured "Uploading" percentage -- the request-body send phase
    // is the only part of this flow whose progress is actually observable
    // client-side. Once the body finishes sending, the browser gives no
    // further signal until the response arrives (extraction + scan +
    // verdict all happen server-side in that one request), so "Analyzing"
    // is deliberately shown as indeterminate rather than a fabricated
    // percentage.
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

  return (
    <div className="space-y-4">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center seq-transition",
          phase === "dragging"
            ? "border-primary bg-primary/5"
            : phase === "error"
              ? "border-danger/40 bg-danger/5"
              : "border-border/60 bg-transparent"
        )}
      >
        {phase === "idle" || phase === "dragging" ? (
          <>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-muted/40">
              <UploadCloud className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm font-medium">
              {phase === "dragging" ? t("dropzone.dragging") : t("dropzone.idle")}
            </p>
            <p className="text-xs text-muted-foreground">{t("dropzone.hint")}</p>
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              {t("dropzone.browse")}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".zip"
              className="sr-only"
              onChange={handleBrowseChange}
              aria-label={t("dropzone.browse")}
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
                <FileArchive className="h-4 w-4 text-muted-foreground" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file?.name}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {file ? formatBytes(file.size) : null}
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
            <Label htmlFor="upload-project-name">{t("projectNameLabel")}</Label>
            <Input
              id="upload-project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              maxLength={100}
            />
          </div>
          <Button className="w-full" onClick={() => void analyze()}>
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

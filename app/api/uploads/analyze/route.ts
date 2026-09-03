import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { extractZipArchive, ZipValidationError } from "@/lib/upload/zip-extract";
import { normalizeLocalFiles, LocalFilesValidationError } from "@/lib/upload/normalize-local-files";
import { buildUploadSnapshot } from "@/lib/upload/build-upload-snapshot";
import { runUploadScan, UploadScanError } from "@/server/uploads/run-upload-scan";
import { SOURCE_ANALYSIS_LIMITS, LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES } from "@/lib/upload/source-limits";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Compressed archive *transport* cap -- a ZIP-specific limit on the bytes
 * actually carried over the wire, independent of GITHUB_SCAN_LIMITS
 * .maxTotalBytes (the *uncompressed* source budget, enforced inside
 * extractZipArchive/normalizeLocalFiles). Text-heavy source archives
 * commonly compress 5-10x, so 8 MB compressed still allows meaningfully
 * sized projects while staying well under typical serverless body ceilings.
 * This does NOT apply to Local Analysis: those files arrive already
 * expanded (never compressed), so holding them to a compressed-transport
 * budget was an unintended, overly strict carryover from the ZIP path --
 * fixed in Phase 11.1 by giving each ingestion method its own transport
 * ceiling below.
 */
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;

/**
 * Local Analysis transport cap.
 *
 * Ideally this would simply be SOURCE_ANALYSIS_LIMITS.maxTotalBytes (40MB) --
 * the same canonical source budget every other ingestion method uses. It
 * can't be: GitHub scans reach that 40MB by streaming server-to-server from
 * GitHub's API, never through this app's own request/proxy pipeline. Local
 * Analysis's raw (uncompressed) files go through the actual Next.js request
 * body, which this deployment's proxy.ts enforces a real, measured 10MB
 * default ceiling on (confirmed live: a >10MB multipart body is silently
 * truncated before this route ever sees it, producing a confusing
 * malformed-multipart parse failure rather than a clean error). Raising
 * that platform-wide default (experimental.proxyClientMaxBodySize) is a
 * global config change out of scope for this closure pass, so this cap is
 * set safely under the real ceiling instead -- disclosed here rather than
 * silently claiming the full 40MB works when it does not.
 */
const MAX_LOCAL_REQUEST_BYTES = LOCAL_ANALYSIS_TRANSPORT_MAX_BYTES;

const ERROR_MESSAGES: Record<string, string> = {
  archive_too_large: "This archive is too large. The beta limit is 8 MB compressed.",
  request_too_large: "This project is too large to analyze.",
  invalid_archive: "This file could not be read as a ZIP archive.",
  corrupt_archive: "This archive is corrupt or contains unsafe entries and could not be processed.",
  too_many_entries: "This project has too many files to analyze.",
  empty_archive: "This archive is empty.",
  empty_project: "No files were selected.",
  no_source_files: "No supported source files were found in this project.",
  max_total_size: "Project exceeds the maximum source size.",
  max_file_size: "A file in this project exceeds the maximum file size.",
};

function humanReadableUploadError(error: ZipValidationError | LocalFilesValidationError): string {
  return ERROR_MESSAGES[error.code] ?? "This project could not be analyzed.";
}

/**
 * Canonical source-analysis limits, applied identically to ZIP and Local
 * Analysis -- the only difference between the two ingestion methods is the
 * *transport* ceiling above, not these.
 */
const SOURCE_LIMITS = SOURCE_ANALYSIS_LIMITS;

const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .optional();

async function handleUpload(request: Request) {
  const rateLimited = await enforceRateLimit(request, {
    limit: 10,
    windowMs: 10 * 60_000,
    keyPrefix: "upload-analyze",
    errorMessage: "Too many uploads. Try again later.",
  });
  if (rateLimited) return rateLimited;

  // Tenant identity comes only from authenticated server context (including
  // the dev-only SEQURAI_BYPASS_AUTH path other authenticated routes already
  // use) -- never from the request body.
  const auth = await getServerAuthContext();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { user, organizationId } = auth;
  if (!organizationId) {
    return NextResponse.json(
      { error: "No active workspace", code: "workspace_not_found" },
      { status: 404 }
    );
  }

  // The request could be either a compressed ZIP (tight MAX_ARCHIVE_BYTES
  // transport budget) or already-expanded Local Analysis files (the larger
  // canonical source budget) -- which one it is isn't known until formData
  // is parsed below. Gate on the larger (local) ceiling here so a ZIP never
  // gets an inflated allowance; extractZipArchive enforces the tighter
  // MAX_ARCHIVE_BYTES transport limit on the actual ZIP buffer afterward.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_LOCAL_REQUEST_BYTES) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.request_too_large, code: "request_too_large" },
      { status: 413 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Could not read the upload.", code: "invalid_request" },
      { status: 422 }
    );
  }

  const file = formData.get("file");
  const localFiles = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  const isLocalAnalysis = !(file instanceof File) && localFiles.length > 0;

  if (!(file instanceof File) && !isLocalAnalysis) {
    return NextResponse.json(
      { error: "No file was provided.", code: "missing_file" },
      { status: 422 }
    );
  }

  const projectNameParsed = projectNameSchema.safeParse(formData.get("projectName") ?? undefined);
  const defaultProjectName =
    file instanceof File ? file.name.replace(/\.zip$/i, "") : "Local project";
  const projectName =
    projectNameParsed.success && projectNameParsed.data
      ? projectNameParsed.data
      : defaultProjectName.slice(0, 100) || "Uploaded project";

  let extraction: { files: Awaited<ReturnType<typeof extractZipArchive>>["files"]; totalBytes: number; omissions: Awaited<ReturnType<typeof extractZipArchive>>["omissions"] };
  try {
    if (isLocalAnalysis) {
      const entries = await Promise.all(
        localFiles.map(async (entry) => ({
          // webkitRelativePath (e.g. "my-project/src/index.ts") is what the
          // browser's directory picker sets; entry.name alone would lose
          // the folder structure sanitizePath/isRelevantPath rely on.
          path: (entry as File & { webkitRelativePath?: string }).webkitRelativePath || entry.name,
          content: Buffer.from(await entry.arrayBuffer()),
        }))
      );
      extraction = normalizeLocalFiles(entries, SOURCE_LIMITS);
    } else {
      const buffer = Buffer.from(await (file as File).arrayBuffer());
      extraction = await extractZipArchive(buffer, {
        ...SOURCE_LIMITS,
        maxArchiveBytes: MAX_ARCHIVE_BYTES,
      });
    }
  } catch (error) {
    if (error instanceof ZipValidationError || error instanceof LocalFilesValidationError) {
      return NextResponse.json(
        { error: humanReadableUploadError(error), code: error.code },
        { status: 422 }
      );
    }
    console.error("upload_extraction_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      mode: isLocalAnalysis ? "local" : "zip",
    });
    return NextResponse.json(
      { error: "This project could not be analyzed.", code: "extraction_failed" },
      { status: 422 }
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Upload analysis is not configured.", code: "internal_error" },
      { status: 500 }
    );
  }

  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({
      organization_id: organizationId,
      name: projectName,
      description: null,
      connected_by_user_id: user.id,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    console.error("upload_project_creation_failed", { code: projectError?.code });
    return NextResponse.json(
      { error: "Could not create the project for this upload.", code: "project_creation_failed" },
      { status: 500 }
    );
  }

  const projectId = project.id as string;
  const snapshot = buildUploadSnapshot({
    projectName,
    files: extraction.files,
    totalBytes: extraction.totalBytes,
    omissions: extraction.omissions,
  });

  try {
    const { scanId } = await runUploadScan(admin, {
      organizationId,
      projectId,
      userId: user.id,
      snapshot,
      source: isLocalAnalysis ? "local" : "upload",
    });

    return NextResponse.json({ projectId, scanId });
  } catch (error) {
    console.error("upload_scan_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: error instanceof UploadScanError ? error.code : undefined,
    });
    return NextResponse.json(
      { error: "The scan could not be completed.", code: "scan_failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    return await handleUpload(request);
  } catch (error) {
    console.error("upload_analyze_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 }
    );
  }
}

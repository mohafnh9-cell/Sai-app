import type { SbomEcosystem } from "../sbom/types";

export const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
export const OSV_BATCH_SIZE = 1000;
export const OSV_FETCH_TIMEOUT_MS = 30_000;

export type OsvQueryPackage = {
  name: string;
  version: string;
  ecosystem: SbomEcosystem;
  namespace?: string;
  purl?: string;
};

export type OsvSeverityLevel = "critical" | "high" | "medium" | "low" | "unknown";

export type OsvMappedVulnerability = {
  osvId: string;
  advisoryId: string;
  aliases: string[];
  description: string;
  severity: OsvSeverityLevel;
  cvssScore: number | null;
  cvssMethod: string | null;
  affectedVersionRange: string | null;
  fixedVersion: string | null;
  sourceUrl: string;
};

export type OsvBatchResult = Map<string, OsvMappedVulnerability[]>;

export type OsvQueryErrorCode =
  | "network_error"
  | "timeout"
  | "rate_limited"
  | "malformed_response"
  | "unavailable";

export class OsvQueryError extends Error {
  constructor(
    message: string,
    readonly code: OsvQueryErrorCode
  ) {
    super(message);
    this.name = "OsvQueryError";
  }
}

export type OsvApiVulnerability = {
  id?: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  severity?: Array<{ type?: string; score?: string | number }>;
  database_specific?: { severity?: string };
  affected?: Array<{
    package?: { name?: string; ecosystem?: string };
    ranges?: Array<{
      type?: string;
      events?: Array<{ introduced?: string; fixed?: string; last_affected?: string }>;
    }>;
  }>;
};

import { NextResponse } from "next/server";

/** HTTP header name for the internal ops shared secret (not a credential value). */
export const INTERNAL_OPS_AUTH_HEADER = "x-sequrai-ops-token";

export function isInternalOpsTokenConfigured(): boolean {
  return Boolean(process.env.INTERNAL_OPS_TOKEN?.trim());
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Returns true when the request presents a valid internal ops token. */
export function verifyInternalOpsRequest(request: Request): boolean {
  const expected = process.env.INTERNAL_OPS_TOKEN?.trim();
  if (!expected) return false;
  const provided = request.headers.get(INTERNAL_OPS_AUTH_HEADER)?.trim();
  if (!provided) return false;
  return timingSafeEqualString(provided, expected);
}

export function internalOpsUnauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Use at the start of internal API handlers; returns a 401 response or null if authorized. */
export function assertInternalOpsAuthorized(request: Request): NextResponse | null {
  if (verifyInternalOpsRequest(request)) return null;
  return internalOpsUnauthorizedResponse();
}

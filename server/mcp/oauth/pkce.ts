import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { OAuthError } from "./errors";
import { PKCE_METHOD_S256, type PkceMethod } from "./types";

const CODE_VERIFIER_MIN = 43;
const CODE_VERIFIER_MAX = 128;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9\-._~]+$/;

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function computeS256Challenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function validateCodeVerifier(codeVerifier: string): void {
  if (
    codeVerifier.length < CODE_VERIFIER_MIN ||
    codeVerifier.length > CODE_VERIFIER_MAX ||
    !CODE_CHALLENGE_PATTERN.test(codeVerifier)
  ) {
    throw new OAuthError("invalid_request", "Invalid code_verifier");
  }
}

export function validateCodeChallenge(codeChallenge: string): void {
  if (!codeChallenge || !CODE_CHALLENGE_PATTERN.test(codeChallenge)) {
    throw new OAuthError("invalid_request", "Invalid code_challenge");
  }
}

export function validatePkceMethod(method: string | null | undefined): PkceMethod {
  if (!method) {
    throw new OAuthError("invalid_request", "code_challenge_method is required");
  }
  if (method !== PKCE_METHOD_S256) {
    throw new OAuthError("invalid_request", "Only S256 code_challenge_method is supported");
  }
  return PKCE_METHOD_S256;
}

export function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
  codeChallengeMethod: string
): void {
  validateCodeVerifier(codeVerifier);
  validatePkceMethod(codeChallengeMethod);

  const expected = computeS256Challenge(codeVerifier);
  if (expected !== codeChallenge) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }
}

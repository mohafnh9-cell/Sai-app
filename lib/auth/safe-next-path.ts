/**
 * Post-authentication redirect validation (integrity, not encryption).
 *
 * Guarantee: the returned value is an internal, same-origin path
 * ("/…", never "//…") that no browser or URL parser can interpret as another
 * origin. Anything else yields `fallback`, which is a trusted constant of the
 * caller, never attacker-controlled input.
 *
 * Why not only prefix checks: URL parsers treat `\` like `/` and silently
 * delete tab / CR / LF, so `/\evil.com` and `/<tab>/evil.com` resolve to
 * `https://evil.com/` even though they start with a single `/`. So after the
 * syntactic checks the candidate is parsed against a fixed dummy origin and the
 * NORMALIZED result is what is returned and re-checked.
 */
const DUMMY_ORIGIN = "https://sequrai.invalid";
const MAX_LENGTH = 2048;
const MAX_DECODE_ROUNDS = 3;

/** Backslash, ASCII/C1 control characters, invisible format characters and Unicode spaces other than U+0020. */
const FORBIDDEN_DECODED =
  /[\\\u0000-\u001f\u007f-\u009f\u00a0\u00ad\u061c\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u3000\ufeff\ufff9-\ufffb]/u;
/** The raw value additionally may not contain any whitespace at all (a plain space included). */
const FORBIDDEN_RAW = new RegExp(`${FORBIDDEN_DECODED.source}|\\s`, "u");

function hasInternalPathShape(candidate: string, forbidden: RegExp): boolean {
  return candidate.startsWith("/") && !candidate.startsWith("//") && !forbidden.test(candidate);
}

export function safeNextPath(value: string | null | undefined, fallback = "/onboarding"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) {
    return fallback;
  }

  // The value itself and every percent-decoded form of it must have the shape
  // of an internal path: encoded backslashes (%5c), encoded slashes (%2f),
  // encoded control characters (%09 %0a %0d) must not be able to turn into an
  // external target once something downstream decodes the value.
  let candidate = value;
  for (let round = 0; ; round += 1) {
    if (!hasInternalPathShape(candidate, round === 0 ? FORBIDDEN_RAW : FORBIDDEN_DECODED)) return fallback;
    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      return fallback; // malformed percent-encoding
    }
    if (decoded === candidate) break;
    if (round >= MAX_DECODE_ROUNDS) return fallback; // still changing: suspicious nesting
    candidate = decoded;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, DUMMY_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== DUMMY_ORIGIN) return fallback;

  // Return the normalized form (dot segments resolved, etc.) and re-check it:
  // "/.//evil.com" normalizes to "//evil.com", which would be a
  // protocol-relative URL if used as a plain string.
  const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (!hasInternalPathShape(normalized, FORBIDDEN_DECODED)) return fallback;
  return normalized;
}

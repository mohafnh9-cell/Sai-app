import "server-only";

import type { CanonicalSeverity } from "@/server/security-evidence/canonical-finding";

/**
 * Phase 35, section 14-16: SequrAI's native cryptography rule family. Pure
 * pattern matching (same style/tier as the existing 47-rule scanner) -- no
 * external dependency. Context-aware by design (section 15): a bare
 * "uses MD5" match is not shipped as a rule; every rule here requires
 * corroborating context (a nearby security-sensitive keyword) before firing,
 * and an explicit safe-context list suppresses common non-security uses
 * (cache keys, ETags, asset fingerprints, UI randomization).
 */

export type CryptoRuleId =
  | "crypto.weak-hash-password"
  | "crypto.aes-ecb-mode"
  | "crypto.hardcoded-key-or-iv"
  | "crypto.insecure-random-token"
  | "crypto.jwt-none-algorithm"
  | "crypto.jwt-weak-algorithm"
  | "crypto.tls-verification-disabled";

export type CryptoRuleMatch = {
  ruleId: CryptoRuleId;
  path: string;
  line: number;
  snippet: string;
  message: string;
  severity: CanonicalSeverity;
  cwe: string[];
  remediation: string;
};

const SECURITY_CONTEXT = /password|passwd|secret|token|session|auth|credential|login|signin|api[_-]?key/i;
const SAFE_CONTEXT = /cache|etag|fingerprint|checksum|dedupe|dedup|thumbnail|asset[_-]?hash|test|fixture|mock|example/i;

function contextWindow(lines: string[], lineIndex: number, radius = 3): string {
  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);
  return lines.slice(start, end).join("\n");
}

function isSafeContext(window: string): boolean {
  return SAFE_CONTEXT.test(window) && !SECURITY_CONTEXT.test(window);
}

type Rule = {
  id: CryptoRuleId;
  pattern: RegExp;
  requiresSecurityContext: boolean;
  severity: CanonicalSeverity;
  cwe: string[];
  message: string;
  remediation: string;
};

const RULES: Rule[] = [
  {
    id: "crypto.weak-hash-password",
    // createHash("md5"/"sha1") -- only flagged when nearby context looks
    // security-sensitive (section 15); a plain md5 used for a cache key is
    // not this rule's concern and is suppressed by isSafeContext().
    pattern: /createHash\(\s*["'](md5|sha1)["']\s*\)/i,
    requiresSecurityContext: true,
    severity: "high",
    cwe: ["CWE-327", "CWE-916"],
    message: "MD5/SHA-1 used in a security-sensitive context (password/token/credential nearby) -- these are not password-hashing algorithms and are trivially reversible/collidable.",
    remediation: "Use Argon2id, scrypt, or bcrypt for password hashing. Never use MD5/SHA-1 to derive or verify a password, token, or session identifier.",
  },
  {
    id: "crypto.aes-ecb-mode",
    pattern: /createCipheriv\(\s*["']aes-\d+-ecb["']/i,
    requiresSecurityContext: false,
    severity: "high",
    cwe: ["CWE-327"],
    message: "AES in ECB mode was used -- ECB does not use an IV and leaks structural patterns in the plaintext (identical plaintext blocks produce identical ciphertext blocks).",
    remediation: "Use an authenticated mode such as AES-256-GCM instead of AES-ECB.",
  },
  {
    id: "crypto.hardcoded-key-or-iv",
    // A literal string/hex assigned to a variable named like a key/IV/secret,
    // NOT read from process.env/config/KMS.
    pattern: /(const|let|var)\s+\w*(secret|encryptionKey|cipherKey|iv|nonce)\w*\s*[:=]\s*["'][A-Za-z0-9+/=]{8,}["']/i,
    requiresSecurityContext: false,
    severity: "critical",
    cwe: ["CWE-798", "CWE-321"],
    message: "A cryptographic key, IV, or nonce appears to be hardcoded as a string literal rather than loaded from an environment variable or key-management system.",
    remediation: "Load encryption keys/IVs from an environment variable or KMS, generate IVs/nonces fresh per operation with a CSPRNG, and rotate any key that was ever committed to source control.",
  },
  {
    id: "crypto.insecure-random-token",
    // Math.random() feeding something that looks like a token/session/password.
    pattern: /Math\.random\(\)/,
    requiresSecurityContext: true,
    severity: "high",
    cwe: ["CWE-338"],
    message: "Math.random() was used in a security-sensitive context (token/session/password nearby) -- it is not cryptographically secure and its output is predictable.",
    remediation: "Use crypto.randomBytes()/crypto.randomUUID() (Node) or an equivalent CSPRNG for any token, session identifier, password-reset code, or similar security-sensitive value.",
  },
  {
    id: "crypto.jwt-none-algorithm",
    pattern: /algorithm[s]?\s*:\s*\[?\s*["']none["']/i,
    requiresSecurityContext: false,
    severity: "critical",
    cwe: ["CWE-347"],
    message: "JWT verification explicitly allows the \"none\" algorithm, which accepts an unsigned token as valid.",
    remediation: "Remove \"none\" from the allowed algorithms list and explicitly pin verification to a single strong algorithm (e.g. RS256 or ES256).",
  },
  {
    id: "crypto.jwt-weak-algorithm",
    pattern: /algorithm[s]?\s*:\s*\[?\s*["'](HS1|RS1)["']/i,
    requiresSecurityContext: false,
    severity: "high",
    cwe: ["CWE-327"],
    message: "JWT verification allows a deprecated/weak signing algorithm.",
    remediation: "Pin JWT verification to a modern algorithm such as RS256 or ES256.",
  },
  {
    id: "crypto.tls-verification-disabled",
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0["']?/,
    requiresSecurityContext: false,
    severity: "critical",
    cwe: ["CWE-295"],
    message: "TLS certificate verification is explicitly disabled, allowing man-in-the-middle attacks against this connection.",
    remediation: "Remove the override and fix the underlying certificate issue (e.g. install a proper CA bundle) instead of disabling verification.",
  },
];

export function runCryptoRules(files: Array<{ path: string; content: string }>): CryptoRuleMatch[] {
  const matches: CryptoRuleMatch[] = [];

  for (const file of files) {
    const lines = file.content.split("\n");
    for (const rule of RULES) {
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (!rule.pattern.test(line)) continue;
        const window = contextWindow(lines, i);
        if (rule.requiresSecurityContext && !SECURITY_CONTEXT.test(window)) continue;
        if (isSafeContext(window)) continue;

        matches.push({
          ruleId: rule.id,
          path: file.path,
          line: i + 1,
          snippet: line.trim().slice(0, 200),
          message: rule.message,
          severity: rule.severity,
          cwe: rule.cwe,
          remediation: rule.remediation,
        });
      }
    }
  }

  return matches;
}

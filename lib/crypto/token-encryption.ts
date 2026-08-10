import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const STANDARD_BASE64_32_BYTE_KEY = /^[A-Za-z0-9+/]{43}=$/;

export type TokenEncryptionErrorCode =
  | "encryption_key_missing"
  | "encryption_key_invalid"
  | "ciphertext_malformed"
  | "key_mismatch_or_ciphertext_corrupt";

export class TokenEncryptionError extends Error {
  constructor(
    public readonly code: TokenEncryptionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TokenEncryptionError";
  }
}

function encryptionKey(): Buffer {
  const raw = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new TokenEncryptionError(
      "encryption_key_missing",
      "GITHUB_TOKEN_ENCRYPTION_KEY is required"
    );
  }
  if (!STANDARD_BASE64_32_BYTE_KEY.test(raw)) {
    throw new TokenEncryptionError(
      "encryption_key_invalid",
      "GITHUB_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as standard base64"
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) {
    throw new TokenEncryptionError(
      "encryption_key_invalid",
      "GITHUB_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as standard base64"
    );
  }
  return key;
}

export function isTokenEncryptionEnabled(): boolean {
  return Boolean(process.env.GITHUB_TOKEN_ENCRYPTION_KEY);
}

export function encryptToken(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString("base64url");
  return `${PREFIX}${payload}`;
}

export function decryptToken(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;

  const key = encryptionKey();
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
  if (raw.length <= IV_LENGTH + TAG_LENGTH) {
    throw new TokenEncryptionError(
      "ciphertext_malformed",
      "Encrypted GitHub token payload is malformed"
    );
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenEncryptionError(
      "key_mismatch_or_ciphertext_corrupt",
      "Encrypted GitHub token could not be authenticated"
    );
  }
}

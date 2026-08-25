import "server-only";

import { isAuthBypassEnabled } from "@/lib/auth/dev-bypass";

function parseAdminEmails(): Set<string> {
  const raw = process.env.SEQURAI_ADMIN_EMAILS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAppAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  if (isAuthBypassEnabled()) return true;
  return parseAdminEmails().has(email.trim().toLowerCase());
}

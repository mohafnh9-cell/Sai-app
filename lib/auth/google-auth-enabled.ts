/**
 * Google is a Supabase Auth provider that must be enabled in the Supabase
 * dashboard (Google Cloud OAuth credentials) before it can be exercised --
 * that isn't something this app's env vars control. Supabase's client SDK
 * has no way to check provider availability before redirecting, and a
 * disabled provider fails as a raw JSON error page on Supabase's own domain
 * (no recovery path, no way for this app to intercept it). Gate the button
 * on this flag so it only appears once Google is actually configured.
 */
export function isGoogleAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SEQURAI_GOOGLE_AUTH_ENABLED === "true";
}

const truthyEnv = (value) => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const bypassEnabled = truthyEnv(process.env.SEQURAI_BYPASS_AUTH);
const skipTargetVerificationEnabled = truthyEnv(process.env.SEQURAI_SKIP_TARGET_VERIFICATION);
const deployedProduction = process.env.VERCEL_ENV === "production";

if (deployedProduction && bypassEnabled) {
  throw new Error(
    "SEQURAI_BYPASS_AUTH cannot be enabled on Vercel production. Remove it from your deployment environment."
  );
}

if (deployedProduction && skipTargetVerificationEnabled) {
  throw new Error(
    "SEQURAI_SKIP_TARGET_VERIFICATION cannot be enabled on Vercel production. Remove it from your deployment environment."
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    tsconfigPath: "./tsconfig.typecheck.json",
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  turbopack: {
    root: import.meta.dirname,
  },
  async redirects() {
    return [
      { source: "/timeline", destination: "/dashboard", permanent: true },
      { source: "/ai-fixes", destination: "/projects", permanent: true },
      { source: "/projects/:id/journey", destination: "/projects/:id", permanent: true },
      { source: "/projects/:id/scans", destination: "/projects/:id", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self'",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io https://vitals.vercel-insights.com",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
  poweredByHeader: false,
};

async function loadConfig() {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return nextConfig;
  }
  const { withSentryConfig } = await import("@sentry/nextjs");
  return withSentryConfig(nextConfig, {
    silent: true,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
  });
}

export default loadConfig();

const bypass = process.env.SEQURAI_BYPASS_AUTH?.trim().toLowerCase();
const bypassEnabled = bypass === "true" || bypass === "1" || bypass === "yes";
const deployedProduction = process.env.VERCEL_ENV === "production";

if (deployedProduction && bypassEnabled) {
  throw new Error(
    "SEQURAI_BYPASS_AUTH cannot be enabled on Vercel production. Remove it from your deployment environment."
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
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
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
  poweredByHeader: false,
};

export default nextConfig;

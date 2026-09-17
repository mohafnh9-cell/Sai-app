// F10/Auto-Security: stub for the "server-only"/"client-only" packages when
// esbuild bundles lib/local-analysis/runtime-entry.ts for public/mcp/
// local-verdict-bundle.mjs (scripts/bundle-local-mcp.mjs's `alias` option).
//
// server/security-engines/* (the external OpenGrep/Trivy/crypto/Scorecard
// engines the local orchestrator calls -- see local-orchestrator.ts) is
// shared, unchanged code between the cloud pipeline (which really does run
// inside Next.js, where "server-only"'s real guard against accidental
// client-bundle inclusion matters) and this local bundle (a plain Node
// script that never runs inside Next.js's client/server module graph at
// all). The real "server-only" package throws unconditionally on import --
// correct behavior inside Next.js, but it broke EVERY local tool call that
// reaches an external engine, because those modules are reachable from this
// bundle's entrypoint. This stub is used ONLY for this one esbuild build;
// the real "server-only" import stays in every source file for the actual
// Next.js app build, so the Client/Server Component guard remains fully
// intact there.
export {};

// Phase 35.5: the "server-only" package throws when imported outside
// Next.js's RSC bundler (which normally intercepts and no-ops it). The
// worker is a standalone Node process, not Next.js, but every
// server/security-*/... module it imports still carries `import
// "server-only"` at the top (correctly, for when those same modules are
// also imported by the Next.js app). This file is esbuild-aliased in place
// of the real package for the worker bundle only -- see
// scripts/bundle-security-worker.mjs.
export {};

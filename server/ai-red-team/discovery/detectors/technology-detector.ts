import type { DetectedTechnology, DiscoveryRepositoryInput } from "../types";

export type DetectionContext = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  filePaths: Set<string>;
  getFileContent: (path: string) => string | null;
  allDependencyNames: Set<string>;
};

type TechnologyRule = {
  id: string;
  name: string;
  category: DetectedTechnology["category"];
  detect: (ctx: DetectionContext) => { confidence: number; evidence: string[] } | null;
};

function dep(ctx: DetectionContext, ...names: string[]): string[] {
  const evidence: string[] = [];
  for (const name of names) {
    if (ctx.allDependencyNames.has(name)) evidence.push(`dependency:${name}`);
  }
  return evidence;
}

function file(ctx: DetectionContext, pattern: RegExp): string[] {
  const matches = [...ctx.filePaths].filter((p) => pattern.test(p));
  return matches.map((p) => `file:${p}`);
}

function content(ctx: DetectionContext, pattern: RegExp, label: string): string[] {
  for (const path of ctx.filePaths) {
    const body = ctx.getFileContent(path);
    if (body && pattern.test(body)) return [`content:${label}@${path}`];
  }
  return [];
}

const RULES: TechnologyRule[] = [
  {
    id: "nextjs",
    name: "Next.js",
    category: "framework",
    detect: (ctx) => {
      const evidence = [...dep(ctx, "next"), ...file(ctx, /next\.config\.(?:js|mjs|ts)$/i)];
      return evidence.length ? { confidence: evidence.some((e) => e.startsWith("dependency:")) ? 0.95 : 0.7, evidence } : null;
    },
  },
  {
    id: "react",
    name: "React",
    category: "library",
    detect: (ctx) => {
      const evidence = dep(ctx, "react", "react-dom");
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "vue",
    name: "Vue",
    category: "framework",
    detect: (ctx) => {
      const evidence = dep(ctx, "vue");
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "angular",
    name: "Angular",
    category: "framework",
    detect: (ctx) => {
      const evidence = [...dep(ctx, "@angular/core"), ...file(ctx, /angular\.json$/i)];
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "svelte",
    name: "Svelte",
    category: "framework",
    detect: (ctx) => {
      const evidence = [...dep(ctx, "svelte"), ...file(ctx, /svelte\.config\.(?:js|ts)$/i)];
      return evidence.length ? { confidence: 0.88, evidence } : null;
    },
  },
  {
    id: "express",
    name: "Express",
    category: "framework",
    detect: (ctx) => {
      const evidence = dep(ctx, "express");
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "fastify",
    name: "Fastify",
    category: "framework",
    detect: (ctx) => {
      const evidence = dep(ctx, "fastify");
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "nestjs",
    name: "NestJS",
    category: "framework",
    detect: (ctx) => {
      const evidence = [...dep(ctx, "@nestjs/core"), ...file(ctx, /nest-cli\.json$/i)];
      return evidence.length ? { confidence: 0.92, evidence } : null;
    },
  },
  {
    id: "supabase",
    name: "Supabase",
    category: "database",
    detect: (ctx) => {
      const evidence = [
        ...dep(ctx, "@supabase/supabase-js", "@supabase/ssr"),
        ...content(ctx, /createClient\s*\(/, "supabase-client"),
      ];
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "firebase",
    name: "Firebase",
    category: "database",
    detect: (ctx) => {
      const evidence = dep(ctx, "firebase", "firebase-admin");
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "clerk",
    name: "Clerk",
    category: "auth",
    detect: (ctx) => {
      const evidence = dep(ctx, "@clerk/nextjs", "@clerk/clerk-react", "@clerk/backend");
      return evidence.length ? { confidence: 0.92, evidence } : null;
    },
  },
  {
    id: "authjs",
    name: "Auth.js",
    category: "auth",
    detect: (ctx) => {
      const evidence = [
        ...dep(ctx, "@auth/core", "next-auth"),
        ...file(ctx, /auth\.(?:ts|js)$/i),
        ...content(ctx, /NextAuth|Auth\.js/, "authjs"),
      ];
      return evidence.length ? { confidence: 0.88, evidence } : null;
    },
  },
  {
    id: "nextauth",
    name: "NextAuth",
    category: "auth",
    detect: (ctx) => {
      const evidence = dep(ctx, "next-auth");
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "payments",
    detect: (ctx) => {
      const evidence = [...dep(ctx, "stripe", "@stripe/stripe-js"), ...content(ctx, /Stripe\(/, "stripe-sdk")];
      return evidence.length ? { confidence: 0.92, evidence } : null;
    },
  },
  {
    id: "lemonsqueezy",
    name: "LemonSqueezy",
    category: "payments",
    detect: (ctx) => {
      const evidence = dep(ctx, "@lemonsqueezy/lemonsqueezy.js");
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "prisma",
    name: "Prisma",
    category: "orm",
    detect: (ctx) => {
      const evidence = [...dep(ctx, "@prisma/client", "prisma"), ...file(ctx, /prisma\/schema\.prisma$/i)];
      return evidence.length ? { confidence: 0.93, evidence } : null;
    },
  },
  {
    id: "drizzle",
    name: "Drizzle",
    category: "orm",
    detect: (ctx) => {
      const evidence = dep(ctx, "drizzle-orm", "drizzle-kit");
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    category: "database",
    detect: (ctx) => {
      const evidence = [
        ...dep(ctx, "pg", "postgres", "@vercel/postgres", "@neondatabase/serverless"),
        ...content(ctx, /postgres(ql)?:\/\//i, "postgres-url"),
        ...content(ctx, /provider\s*=\s*"postgresql"/i, "prisma-postgresql"),
      ];
      return evidence.length ? { confidence: 0.85, evidence } : null;
    },
  },
  {
    id: "mysql",
    name: "MySQL",
    category: "database",
    detect: (ctx) => {
      const evidence = [...dep(ctx, "mysql2"), ...content(ctx, /mysql:\/\//i, "mysql-url")];
      return evidence.length ? { confidence: 0.85, evidence } : null;
    },
  },
  {
    id: "sqlite",
    name: "SQLite",
    category: "database",
    detect: (ctx) => {
      const evidence = [...dep(ctx, "better-sqlite3", "sqlite3"), ...content(ctx, /sqlite:/i, "sqlite-url")];
      return evidence.length ? { confidence: 0.82, evidence } : null;
    },
  },
  {
    id: "redis",
    name: "Redis",
    category: "database",
    detect: (ctx) => {
      const evidence = [...dep(ctx, "redis", "ioredis", "@upstash/redis"), ...content(ctx, /redis:\/\//i, "redis-url")];
      return evidence.length ? { confidence: 0.86, evidence } : null;
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "ai",
    detect: (ctx) => {
      const evidence = dep(ctx, "openai", "@ai-sdk/openai");
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "anthropic",
    name: "Anthropic",
    category: "ai",
    detect: (ctx) => {
      const evidence = dep(ctx, "@anthropic-ai/sdk", "@ai-sdk/anthropic");
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "google-gemini",
    name: "Google Gemini",
    category: "ai",
    detect: (ctx) => {
      const evidence = dep(ctx, "@google/generative-ai", "@ai-sdk/google");
      return evidence.length ? { confidence: 0.88, evidence } : null;
    },
  },
  {
    id: "vercel-ai-sdk",
    name: "Vercel AI SDK",
    category: "ai",
    detect: (ctx) => {
      const evidence = dep(ctx, "ai", "@ai-sdk/react");
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    category: "deployment",
    detect: (ctx) => {
      const evidence = [
        ...dep(ctx, "@cloudflare/workers-types", "wrangler"),
        ...file(ctx, /wrangler\.toml$/i),
      ];
      return evidence.length ? { confidence: 0.86, evidence } : null;
    },
  },
  {
    id: "aws-s3",
    name: "AWS S3",
    category: "storage",
    detect: (ctx) => {
      const evidence = [
        ...dep(ctx, "@aws-sdk/client-s3", "aws-sdk"),
        ...content(ctx, /s3\.amazonaws\.com|S3Client/, "aws-s3"),
      ];
      return evidence.length ? { confidence: 0.84, evidence } : null;
    },
  },
  {
    id: "cloudflare-r2",
    name: "Cloudflare R2",
    category: "storage",
    detect: (ctx) => {
      const evidence = content(ctx, /R2|r2\.cloudflarestorage\.com/i, "cloudflare-r2");
      return evidence.length ? { confidence: 0.75, evidence } : null;
    },
  },
  {
    id: "docker",
    name: "Docker",
    category: "runtime",
    detect: (ctx) => {
      const evidence = [...file(ctx, /(?:^|\/)Dockerfile(?:\.[^/]+)?$/i), ...file(ctx, /docker-compose\.ya?ml$/i)];
      return evidence.length ? { confidence: 0.88, evidence } : null;
    },
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "deployment",
    detect: (ctx) => {
      const evidence = [...file(ctx, /vercel\.json$/i), ...dep(ctx, "@vercel/analytics", "@vercel/speed-insights")];
      return evidence.length ? { confidence: 0.82, evidence } : null;
    },
  },
  {
    id: "railway",
    name: "Railway",
    category: "deployment",
    detect: (ctx) => {
      const evidence = file(ctx, /railway\.(?:toml|json)$/i);
      return evidence.length ? { confidence: 0.8, evidence } : null;
    },
  },
  {
    id: "render",
    name: "Render",
    category: "deployment",
    detect: (ctx) => {
      const evidence = file(ctx, /render\.ya?ml$/i);
      return evidence.length ? { confidence: 0.8, evidence } : null;
    },
  },
  {
    id: "flyio",
    name: "Fly.io",
    category: "deployment",
    detect: (ctx) => {
      const evidence = file(ctx, /fly\.toml$/i);
      return evidence.length ? { confidence: 0.85, evidence } : null;
    },
  },
  {
    id: "github-actions",
    name: "GitHub Actions",
    category: "ci",
    detect: (ctx) => {
      const evidence = file(ctx, /^\.github\/workflows\/.+\.ya?ml$/i);
      return evidence.length ? { confidence: 0.9, evidence } : null;
    },
  },
  {
    id: "inngest",
    name: "Inngest",
    category: "integration",
    detect: (ctx) => {
      const evidence = dep(ctx, "inngest");
      return evidence.length ? { confidence: 0.88, evidence } : null;
    },
  },
  {
    id: "mcp-server",
    name: "MCP Server",
    category: "integration",
    detect: (ctx) => {
      const evidence = [
        ...dep(ctx, "@modelcontextprotocol/sdk"),
        ...file(ctx, /mcp\/server\.ts$/i),
        ...content(ctx, /ModelContextProtocol|mcp\/server/, "mcp-server"),
      ];
      return evidence.length ? { confidence: 0.82, evidence } : null;
    },
  },
];

export function buildDetectionContext(input: DiscoveryRepositoryInput): DetectionContext {
  const filePaths = new Set(input.files.map((f) => f.path));
  const contentByPath = new Map(input.files.map((f) => [f.path, f.content]));
  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};

  for (const file of input.files) {
    if (!file.path.endsWith("package.json")) continue;
    try {
      const parsed = JSON.parse(file.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      Object.assign(dependencies, parsed.dependencies ?? {});
      Object.assign(devDependencies, parsed.devDependencies ?? {});
    } catch {
      // ignore invalid package.json in monorepo leaves
    }
  }

  const allDependencyNames = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)]);

  return {
    dependencies,
    devDependencies,
    filePaths,
    getFileContent: (path) => contentByPath.get(path) ?? null,
    allDependencyNames,
  };
}

export function detectTechnologies(input: DiscoveryRepositoryInput): DetectedTechnology[] {
  const ctx = buildDetectionContext(input);
  const detected: DetectedTechnology[] = [];

  for (const rule of RULES) {
    const match = rule.detect(ctx);
    if (!match || match.confidence <= 0) continue;
    detected.push({
      id: rule.id,
      name: rule.name,
      category: rule.category,
      confidence: match.confidence,
      evidence: match.evidence,
    });
  }

  return detected.sort((a, b) => b.confidence - a.confidence);
}

export function detectPackageManagers(input: DiscoveryRepositoryInput): string[] {
  const paths = input.files.map((f) => f.path);
  const managers = new Set<string>();
  if (paths.some((p) => p.endsWith("pnpm-lock.yaml"))) managers.add("pnpm");
  if (paths.some((p) => p.endsWith("yarn.lock"))) managers.add("yarn");
  if (paths.some((p) => p.endsWith("package-lock.json"))) managers.add("npm");
  if (paths.some((p) => p.endsWith("bun.lockb") || p.endsWith("bun.lock"))) managers.add("bun");
  if (managers.size === 0 && paths.some((p) => p.endsWith("package.json"))) managers.add("npm");
  return [...managers];
}

import type {
  AttackSurfaceArea,
  AttackSurfaceEntry,
  DetectedTechnology,
  DiscoveryRepositoryInput,
} from "../types";
import { buildDetectionContext } from "../detectors/technology-detector";

function hasTech(technologies: DetectedTechnology[], ...ids: string[]): boolean {
  return technologies.some((t) => ids.includes(t.id));
}

function entry(
  area: AttackSurfaceArea,
  label: string,
  rationale: string,
  confidence: number
): AttackSurfaceEntry {
  return { area, label, rationale, confidence };
}

export function buildAttackSurface(
  technologies: DetectedTechnology[],
  input: DiscoveryRepositoryInput
): AttackSurfaceEntry[] {
  const ctx = buildDetectionContext(input);
  const surface: AttackSurfaceEntry[] = [];

  if (hasTech(technologies, "clerk", "authjs", "nextauth", "supabase", "firebase")) {
    surface.push(
      entry(
        "authentication",
        "Authentication",
        "Authentication provider or session library detected in dependencies or config.",
        0.9
      )
    );
    surface.push(
      entry(
        "authorization",
        "Authorization",
        "Authenticated apps typically expose role, session, and route-level authorization boundaries.",
        0.75
      )
    );
  }

  if (hasTech(technologies, "nextjs", "react", "vue", "angular", "svelte")) {
    surface.push(
      entry(
        "browser",
        "Browser",
        "Client-side framework detected — XSS, CSRF, and session exposure should be reviewed.",
        0.88
      )
    );
  }

  if (hasTech(technologies, "express", "fastify", "nestjs", "nextjs")) {
    surface.push(
      entry(
        "rest_api",
        "REST API",
        "Server or API route handlers likely expose HTTP endpoints.",
        hasTech(technologies, "express", "fastify", "nestjs") ? 0.9 : 0.7
      )
    );
  }

  if (hasTech(technologies, "stripe", "lemonsqueezy")) {
    surface.push(
      entry(
        "payments",
        "Payments",
        "Payment provider integration detected — webhooks and checkout flows are in scope.",
        0.92
      )
    );
    surface.push(
      entry("webhooks", "Webhooks", "Payment providers commonly rely on signed webhook endpoints.", 0.8)
    );
  }

  if (hasTech(technologies, "aws-s3", "cloudflare-r2", "supabase")) {
    surface.push(
      entry(
        "storage",
        "Storage",
        "Object or blob storage integration detected.",
        0.82
      )
    );
  }

  if (hasTech(technologies, "openai", "anthropic", "google-gemini", "vercel-ai-sdk")) {
    surface.push(
      entry(
        "llm",
        "LLM",
        "AI provider or Vercel AI SDK usage detected — prompt injection and data leakage are in scope.",
        0.9
      )
    );
  }

  if (hasTech(technologies, "mcp-server")) {
    surface.push(
      entry(
        "mcp_servers",
        "MCP Servers",
        "Model Context Protocol server code detected.",
        0.85
      )
    );
  }

  if ([...ctx.filePaths].some((p) => /upload|multipart|formidable|multer/i.test(p))) {
    surface.push(
      entry("file_uploads", "File Uploads", "Upload-related paths or libraries detected.", 0.7)
    );
  }

  if (
    [...ctx.filePaths].some((p) => /\/admin\b|admin\.(?:tsx|ts|jsx|js)$/i.test(p)) ||
    [...ctx.filePaths].some((p) => {
      const body = ctx.getFileContent(p);
      return Boolean(body && /\/admin|isAdmin|role\s*===\s*['"]admin['"]/i.test(body));
    })
  ) {
    surface.push(
      entry("admin_area", "Admin Area", "Admin routes or role checks detected in repository.", 0.72)
    );
  }

  if (hasTech(technologies, "inngest", "github-actions") || hasTech(technologies, "docker")) {
    surface.push(
      entry(
        "background_jobs",
        "Background Jobs",
        "Async jobs, CI, or container runtime detected.",
        0.78
      )
    );
  }

  if (technologies.some((t) => t.category === "integration")) {
    surface.push(
      entry(
        "third_party_services",
        "Third-party Services",
        "Third-party SDKs or integrations detected in the dependency graph.",
        0.7
      )
    );
  }

  const byArea = new Map<AttackSurfaceArea, AttackSurfaceEntry>();
  for (const item of surface) {
    const existing = byArea.get(item.area);
    if (!existing || item.confidence > existing.confidence) byArea.set(item.area, item);
  }
  return [...byArea.values()].sort((a, b) => b.confidence - a.confidence);
}

export function attackSurfaceToCapabilities(surface: AttackSurfaceEntry[]): string[] {
  const map: Partial<Record<AttackSurfaceArea, string>> = {
    authentication: "authentication",
    authorization: "authorization",
    browser: "browser",
    rest_api: "api",
    payments: "payments",
    storage: "storage",
    llm: "llm",
    mcp_servers: "mcp",
  };
  const caps = new Set<string>();
  for (const entry of surface) {
    const cap = map[entry.area];
    if (cap) caps.add(cap);
  }
  return [...caps];
}

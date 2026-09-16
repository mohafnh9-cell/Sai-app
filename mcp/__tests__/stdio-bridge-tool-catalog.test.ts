import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCAL_TOOL_NAMES } from "@/lib/local-analysis/local-tool-handlers";

/**
 * Core hardening audit (F1): mcp/stdio-bridge.mjs -- the file a connected
 * agent actually loads -- maintains its own hardcoded tool catalog
 * (describeLocalTool/LOCAL_TOOL_DEFINITIONS), separate from
 * lib/local-analysis/local-tool-handlers.ts's LOCAL_TOOL_NAMES. That
 * duplication is what let sequrai_local_fix (added in L1.7/L1.8) go live
 * with the wrong description (silently inheriting the sequrai_local_prepare
 * default) and no correlationKey in its input schema -- undiscoverable/
 * mis-described to any real MCP client building calls from `tools/list`.
 *
 * This file's checks are static/textual, not an executed import: the bridge
 * script has real module-level side effects (reads env files, writes to
 * stderr, and would start a readline listener on stdin) that make it unsafe
 * to import directly in a test process.
 */

const SOURCE_BRIDGE_PATH = join(process.cwd(), "mcp/stdio-bridge.mjs");
const PUBLIC_BRIDGE_PATH = join(process.cwd(), "public/mcp/stdio-bridge.mjs");

// sequrai_local_prepare is the one tool intentionally left to the catch-all
// default case (it IS the "prepare a sanitized manifest" tool).
const TOOLS_WITH_EXPLICIT_DESCRIPTIONS = LOCAL_TOOL_NAMES.filter(
  (name) => name !== "sequrai_local_prepare"
);

describe("mcp/stdio-bridge.mjs local tool catalog", () => {
  it("every local tool name except the catch-all default has its own describeLocalTool branch", () => {
    const source = readFileSync(SOURCE_BRIDGE_PATH, "utf8");
    for (const name of TOOLS_WITH_EXPLICIT_DESCRIPTIONS) {
      expect(source, `mcp/stdio-bridge.mjs is missing a description branch for "${name}"`).toContain(
        `"${name}"`
      );
    }
  });

  it("the input schema declares correlationKey (required by sequrai_local_fix)", () => {
    const source = readFileSync(SOURCE_BRIDGE_PATH, "utf8");
    expect(source).toContain("correlationKey");
  });

  it("the source bridge and the distributed public/mcp copy are byte-identical", () => {
    // The two files are NOT generated from one another (no build step syncs
    // them, unlike local-verdict-bundle.mjs's esbuild step) -- they must be
    // hand-kept identical. This is exactly the second half of F1: even a
    // correct fix to mcp/stdio-bridge.mjs alone would have shipped nothing,
    // because installers download public/mcp/stdio-bridge.mjs.
    const source = readFileSync(SOURCE_BRIDGE_PATH, "utf8");
    const distributed = readFileSync(PUBLIC_BRIDGE_PATH, "utf8");
    expect(distributed).toBe(source);
  });

  it("the install manifest's bridge.sha256 matches the distributed file's real hash", async () => {
    const { createHash } = await import("node:crypto");
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "public/mcp/install-manifest.json"), "utf8")
    ) as { bridge: { sha256: string } };
    const bytes = readFileSync(PUBLIC_BRIDGE_PATH);
    const actual = createHash("sha256").update(bytes).digest("hex");
    expect(manifest.bridge.sha256).toBe(actual);
  });
});

import { pack } from "tar-stream";
import { gzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { extractRepositoryTarball, type TarballExtractionLimits } from "../tarball-extract";

const DEFAULT_LIMITS: TarballExtractionLimits = {
  maxFiles: 100,
  maxFileBytes: 10_000,
  maxTotalBytes: 1_000_000,
  maxDepth: 18,
};

async function buildTarballStream(
  entries: Array<{ name: string; content: string }>,
  root = "acme-widgets-abc1234"
): Promise<Readable> {
  const archive = pack();
  for (const entry of entries) {
    archive.entry({ name: `${root}/${entry.name}` }, entry.content);
  }
  archive.finalize();

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    archive.on("data", (chunk) => chunks.push(chunk as Buffer));
    archive.on("end", () => resolve());
    archive.on("error", reject);
  });

  return Readable.from(gzipSync(Buffer.concat(chunks)));
}

async function extract(
  entries: Array<{ name: string; content: string }>,
  limits: Partial<TarballExtractionLimits> = {}
) {
  const stream = await buildTarballStream(entries);
  return extractRepositoryTarball(stream, { ...DEFAULT_LIMITS, ...limits });
}

describe("extractRepositoryTarball", () => {
  it("strips the synthetic GitHub root directory and keeps relevant source files", async () => {
    const result = await extract([
      { name: "src/app.ts", content: "export const ok = true;" },
      { name: "CHANGELOG.md", content: "# hi" },
    ]);
    expect(result.files.map((file) => file.path)).toEqual(["src/app.ts"]);
    expect(result.files[0].content).toBe("export const ok = true;");
    expect(result.omissions).toContainEqual({ path: "CHANGELOG.md", reason: "irrelevant_markdown" });
  });

  it("omits binary content even under a source extension", async () => {
    const result = await extract([{ name: "src/blob.ts", content: "abc\0def" }]);
    expect(result.files).toHaveLength(0);
    expect(result.omissions).toContainEqual({ path: "src/blob.ts", reason: "binary_file" });
  });

  it("enforces maxFiles via an aggregated max_file_count omission", async () => {
    const result = await extract(
      [
        { name: "a.ts", content: "1" },
        { name: "b.ts", content: "2" },
        { name: "c.ts", content: "3" },
      ],
      { maxFiles: 2 }
    );
    expect(result.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    expect(result.omissions).toContainEqual({ reason: "max_file_count", count: 1 });
  });

  it("enforces maxTotalBytes across files", async () => {
    const result = await extract(
      [
        { name: "a.ts", content: "12345" },
        { name: "b.ts", content: "12345" },
      ],
      { maxTotalBytes: 6 }
    );
    expect(result.files.map((file) => file.path)).toEqual(["a.ts"]);
    expect(result.omissions).toContainEqual({ path: "b.ts", reason: "max_total_size" });
  });

  it("enforces maxFileBytes per file using the declared tar header size", async () => {
    const result = await extract([{ name: "big.ts", content: "x".repeat(50) }], {
      maxFileBytes: 10,
    });
    expect(result.files).toHaveLength(0);
    expect(result.omissions).toContainEqual({ path: "big.ts", reason: "max_file_size" });
  });
});

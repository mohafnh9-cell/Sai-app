import { describe, expect, it } from "vitest";
import { crc32 } from "node:zlib";
import * as yazl from "yazl";
import { extractZipArchive, ZipValidationError } from "../zip-extract";

const DEFAULT_LIMITS = {
  maxFiles: 100,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxDepth: 12,
  maxArchiveBytes: 20 * 1024 * 1024,
};

/** Builds a real ZIP buffer via yazl so tests exercise actual archive parsing, not a mock. */
async function buildZip(
  entries: Array<{ path: string; content?: string; mode?: number; isDir?: boolean }>
): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    if (entry.isDir) {
      zip.addEmptyDirectory(entry.path);
    } else {
      zip.addBuffer(Buffer.from(entry.content ?? ""), entry.path, {
        mode: entry.mode,
      });
    }
  }
  zip.end();

  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * yazl (the writer library used everywhere else in this file) itself
 * refuses to construct a traversal or absolute-path entry -- which is
 * reassuring about well-behaved tools, but means it can't be used to build
 * a test fixture for a genuinely malicious archive. A real attacker isn't
 * bound by yazl's validation, so this hand-rolls the minimal raw ZIP bytes
 * (STORED/uncompressed, single entry) needed to prove extractZipArchive's
 * OWN defense actually rejects a hostile entry name, not just yazl's.
 */
function buildRawMaliciousZip(entryName: string, content: string): Buffer {
  const nameBuf = Buffer.from(entryName, "utf8");
  const dataBuf = Buffer.from(content, "utf8");
  const crc = crc32(dataBuf);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(dataBuf.length, 18);
  localHeader.writeUInt32LE(dataBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const localEntry = Buffer.concat([localHeader, nameBuf, dataBuf]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(dataBuf.length, 20);
  centralHeader.writeUInt32LE(dataBuf.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const centralEntry = Buffer.concat([centralHeader, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralEntry.length, 12);
  eocd.writeUInt32LE(localEntry.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localEntry, centralEntry, eocd]);
}

describe("extractZipArchive raw-bytes attack fixtures (bypassing well-behaved zip writers)", () => {
  // yauzl itself is opened with strictFileNames: true, which refuses to even
  // parse an archive containing a ".."-segment or absolute-path entry name --
  // discovered by these tests, which is a *stronger* guarantee than "skip
  // just that one entry": the whole untrusted archive fails closed the
  // moment any entry name is unsafe, verified against real hand-crafted
  // bytes rather than yazl's own (unbypassable) writer-side validation.
  it("rejects the entire archive on a hand-crafted ../ traversal entry", async () => {
    const zip = buildRawMaliciousZip("../../etc/passwd", "root:x:0:0");
    await expect(extractZipArchive(zip, DEFAULT_LIMITS)).rejects.toBeInstanceOf(
      ZipValidationError
    );
  });

  it("rejects the entire archive on a hand-crafted absolute-path entry", async () => {
    const zip = buildRawMaliciousZip("/etc/passwd", "root:x:0:0");
    await expect(extractZipArchive(zip, DEFAULT_LIMITS)).rejects.toBeInstanceOf(
      ZipValidationError
    );
  });

  it("rejects the entire archive on a hand-crafted normalized traversal (a/../../b)", async () => {
    const zip = buildRawMaliciousZip("a/../../b/escape.ts", "x");
    await expect(extractZipArchive(zip, DEFAULT_LIMITS)).rejects.toBeInstanceOf(
      ZipValidationError
    );
  });
});

describe("extractZipArchive", () => {
  it("extracts a normal small project with supported source files", async () => {
    const zip = await buildZip([
      { path: "package.json", content: '{"name":"demo"}' },
      { path: "src/index.ts", content: "export const x = 1;" },
      { path: "src/lib/util.ts", content: "export function f() {}" },
    ]);

    const result = await extractZipArchive(zip, DEFAULT_LIMITS);

    expect(result.files.map((f) => f.path).sort()).toEqual([
      "package.json",
      "src/index.ts",
      "src/lib/util.ts",
    ]);
  });

  it("handles nested directories correctly", async () => {
    const zip = await buildZip([
      { path: "a/b/c/d/deep.ts", content: "export const deep = true;" },
    ]);
    const result = await extractZipArchive(zip, DEFAULT_LIMITS);
    expect(result.files[0]?.path).toBe("a/b/c/d/deep.ts");
  });

  // Traversal-entry tests live in the "raw-bytes attack fixtures" describe
  // block above -- yazl (this file's normal fixture builder) itself refuses
  // to construct a "../" or absolute-path entry, so those cases need a
  // hand-rolled malicious archive to actually exercise the defense.

  it("rejects a symlink entry instead of extracting it", async () => {
    // S_IFLNK (0xA000) | 0777 permissions -- a real unix symlink mode bit pattern.
    const zip = await buildZip([
      { path: "evil-link", content: "/etc/passwd", mode: 0o120777 },
      { path: "src/safe.ts", content: "export const ok = true;" },
    ]);

    const result = await extractZipArchive(zip, DEFAULT_LIMITS);

    expect(result.files.map((f) => f.path)).toEqual(["src/safe.ts"]);
    expect(result.omissions.some((o) => o.reason === "symlink_rejected")).toBe(true);
  });

  it("throws a clean ZipValidationError on a malformed archive instead of crashing", async () => {
    const garbage = Buffer.from("this is not a zip file at all, just bytes");

    await expect(extractZipArchive(garbage, DEFAULT_LIMITS)).rejects.toBeInstanceOf(
      ZipValidationError
    );
  });

  it("rejects an archive larger than maxArchiveBytes before attempting to parse it", async () => {
    const zip = await buildZip([{ path: "a.ts", content: "x".repeat(1000) }]);

    await expect(
      extractZipArchive(zip, { ...DEFAULT_LIMITS, maxArchiveBytes: 10 })
    ).rejects.toMatchObject({ code: "archive_too_large" });
  });

  it("actually enforces maxTotalBytes during real decompression (not just a size hint)", async () => {
    // Real content well over the limit -- proves the running-total check
    // during streamed decompression works, not just a pre-check on a header.
    const bigContent = "a".repeat(5000);
    const zip = await buildZip([
      { path: "a.ts", content: bigContent },
      { path: "b.ts", content: bigContent },
      { path: "c.ts", content: bigContent },
    ]);

    const result = await extractZipArchive(zip, { ...DEFAULT_LIMITS, maxTotalBytes: 6000 });

    const keptBytes = result.files.reduce((sum, f) => sum + f.size, 0);
    expect(keptBytes).toBeLessThanOrEqual(6000);
    expect(result.omissions.some((o) => o.reason === "max_total_size")).toBe(true);
  });

  it("actually enforces maxFileBytes on a real oversized single file", async () => {
    const zip = await buildZip([
      { path: "huge.ts", content: "a".repeat(5000) },
      { path: "small.ts", content: "ok" },
    ]);

    const result = await extractZipArchive(zip, { ...DEFAULT_LIMITS, maxFileBytes: 1000 });

    expect(result.files.map((f) => f.path)).toEqual(["small.ts"]);
    expect(result.omissions.some((o) => o.reason === "max_file_size")).toBe(true);
  });

  it("enforces maxFiles across a real archive with many entries", async () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      path: `file-${i}.ts`,
      content: `export const n = ${i};`,
    }));
    const zip = await buildZip(entries);

    const result = await extractZipArchive(zip, { ...DEFAULT_LIMITS, maxFiles: 5 });

    expect(result.files).toHaveLength(5);
    expect(result.omissions.some((o) => o.reason === "max_file_count")).toBe(true);
  });

  it("rejects an empty archive", async () => {
    const zip = await buildZip([]);
    await expect(extractZipArchive(zip, DEFAULT_LIMITS)).rejects.toMatchObject({
      code: "empty_archive",
    });
  });

  it("rejects an archive containing only .git, with a useful reason", async () => {
    const zip = await buildZip([
      { path: ".git/HEAD", content: "ref: refs/heads/main" },
      { path: ".git/config", content: "[core]" },
    ]);

    await expect(extractZipArchive(zip, DEFAULT_LIMITS)).rejects.toMatchObject({
      code: "no_source_files",
    });
  });

  it("rejects an archive containing only node_modules", async () => {
    const zip = await buildZip([
      { path: "node_modules/lodash/index.js", content: "module.exports = {};" },
    ]);

    await expect(extractZipArchive(zip, DEFAULT_LIMITS)).rejects.toMatchObject({
      code: "no_source_files",
    });
  });

  it("silently skips binary/generated files while keeping real source", async () => {
    const zip = await buildZip([
      { path: "logo.png", content: "\x89PNG\r\n\x1a\n" + "binarydata".repeat(5) },
      { path: "src/app.ts", content: "export const app = true;" },
    ]);

    const result = await extractZipArchive(zip, DEFAULT_LIMITS);

    expect(result.files.map((f) => f.path)).toEqual(["src/app.ts"]);
  });

  it("skips directory entries without treating them as files", async () => {
    const zip = await buildZip([
      { path: "src/", isDir: true },
      { path: "src/index.ts", content: "export {};" },
    ]);

    const result = await extractZipArchive(zip, DEFAULT_LIMITS);
    expect(result.files).toHaveLength(1);
  });
});

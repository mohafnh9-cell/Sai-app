import { describe, expect, it } from "vitest";
import { cachedRead, invalidateProjectCache, resetReadCacheForTests } from "../read-cache";

describe("read-cache", () => {
  it("caches loader results until TTL expires", async () => {
    resetReadCacheForTests();
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return { ok: true };
    };
    const a = await cachedRead("production_memory_summary", "proj-1", loader, { ttlMs: 60_000 });
    const b = await cachedRead("production_memory_summary", "proj-1", loader, { ttlMs: 60_000 });
    expect(a).toEqual(b);
    expect(loads).toBe(1);
  });

  it("invalidates project keys deterministically", async () => {
    resetReadCacheForTests();
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return loads;
    };
    await cachedRead("protection_center_model", "proj-2", loader);
    invalidateProjectCache("proj-2");
    await cachedRead("protection_center_model", "proj-2", loader);
    expect(loads).toBe(2);
  });
});

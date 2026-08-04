import { describe, expect, it } from "vitest";
import {
  appendAnalysisRunSearchParams,
  withAnalysisRunQuery,
} from "../build-run-query";

describe("withAnalysisRunQuery", () => {
  it("returns href unchanged when run id is absent", () => {
    expect(withAnalysisRunQuery("/projects/p/mission-control")).toBe(
      "/projects/p/mission-control"
    );
    expect(withAnalysisRunQuery("/projects/p/mission-control", null)).toBe(
      "/projects/p/mission-control"
    );
  });

  it("appends run query param", () => {
    expect(withAnalysisRunQuery("/projects/p/mission-control", "scan-1")).toBe(
      "/projects/p/mission-control?run=scan-1"
    );
  });

  it("preserves existing query params", () => {
    expect(
      withAnalysisRunQuery("/projects/p/mission-control?onboarded=1", "scan-1")
    ).toBe("/projects/p/mission-control?onboarded=1&run=scan-1");
  });

  it("preserves hash fragments", () => {
    expect(
      withAnalysisRunQuery("/projects/p/mission-control#feed", "scan-1")
    ).toBe("/projects/p/mission-control?run=scan-1#feed");
  });

  it("overwrites existing run param", () => {
    expect(
      withAnalysisRunQuery("/projects/p/mission-control?run=old", "new")
    ).toBe("/projects/p/mission-control?run=new");
  });
});

describe("appendAnalysisRunSearchParams", () => {
  it("sets run when provided", () => {
    const params = new URLSearchParams({ onboarded: "1" });
    appendAnalysisRunSearchParams(params, "scan-1");
    expect(params.get("run")).toBe("scan-1");
    expect(params.get("onboarded")).toBe("1");
  });

  it("leaves params unchanged when run is absent", () => {
    const params = new URLSearchParams({ onboarded: "1" });
    appendAnalysisRunSearchParams(params, null);
    expect(params.has("run")).toBe(false);
  });
});

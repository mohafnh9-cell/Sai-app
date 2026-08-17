import { describe, expect, it } from "vitest";
import { buildBreadcrumbsFromPathname } from "@/lib/navigation/breadcrumbs";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

describe("buildBreadcrumbsFromPathname", () => {
  it("maps dashboard root", () => {
    expect(buildBreadcrumbsFromPathname("/dashboard")).toEqual([
      { label: "Mission Control", href: undefined },
    ]);
  });

  it("maps project mission control path", () => {
    const items = buildBreadcrumbsFromPathname(
      `/projects/${PROJECT_ID}/mission-control`,
      {
        projectName: () => "My App",
      }
    );
    expect(items).toEqual([
      { label: "Projects", href: "/projects" },
      { label: "My App", href: `/projects/${PROJECT_ID}` },
      { label: "Production Intelligence", href: undefined },
    ]);
  });
});

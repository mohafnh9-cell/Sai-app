import { describe, expect, it } from "vitest";
import { gitHubRepositoryReferenceFromApi } from "../repository-reference";

describe("GitHub connect persistence reference", () => {
  it("stores GitHub html_url without duplicating owner from full_name", () => {
    const reference = gitHubRepositoryReferenceFromApi({
      full_name: "mohafnh9-cell/sequrai-app",
      html_url: "https://github.com/mohafnh9-cell/sequrai-app",
    });
    expect(reference.htmlUrl).toBe("https://github.com/mohafnh9-cell/sequrai-app");
    expect(reference.fullName).toBe("mohafnh9-cell/sequrai-app");
  });
});

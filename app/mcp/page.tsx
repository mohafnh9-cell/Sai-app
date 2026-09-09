import type { Metadata } from "next";
import { I18nShell } from "@/components/shared/I18nShell";
import { LandingNavbar } from "@/components/landing/nav";
import { Footer } from "@/components/landing/footer";
import { McpSection } from "@/components/landing/mcp-section";
import { McpPageBody } from "@/components/landing/mcp-page-body";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";

export const metadata: Metadata = {
  title: "MCP — SequrAI",
  description:
    "Connect Claude Code, Cursor, or any MCP-compatible coding agent to SequrAI's security intelligence.",
};

export default async function McpPage() {
  const auth = await getServerAuthContext();
  const isAuthenticated = Boolean(auth);

  return (
    <I18nShell namespaces={["common", "navigation", "landing"]}>
      <div className="min-h-app overflow-x-clip bg-background-deep">
        <LandingNavbar isAuthenticated={isAuthenticated} />
        <main className="pt-28 md:pt-32">
          <McpPageBody isAuthenticated={isAuthenticated} />
          <McpSection />
        </main>
        <Footer />
      </div>
    </I18nShell>
  );
}

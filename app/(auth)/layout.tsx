import type { Metadata } from "next";
import { I18nShell } from "@/components/shared/I18nShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nShell namespaces={["common", "auth"]}>
      <div className="flex min-h-app flex-col items-center justify-center bg-background p-6 safe-top safe-bottom">
        {children}
      </div>
    </I18nShell>
  );
}

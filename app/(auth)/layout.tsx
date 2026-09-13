import type { Metadata } from "next";
import { I18nShell } from "@/components/shared/I18nShell";
import { AppPaletteScope } from "@/components/shared/AppPaletteScope";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nShell namespaces={["common", "auth"]}>
      <AppPaletteScope>
        <div className="flex min-h-app flex-col items-center justify-center bg-background p-6 safe-top safe-bottom">
          {children}
        </div>
      </AppPaletteScope>
    </I18nShell>
  );
}

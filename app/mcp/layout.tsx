import { AppPaletteScope } from "@/components/shared/AppPaletteScope";

export default function McpLayout({ children }: { children: React.ReactNode }) {
  return <AppPaletteScope>{children}</AppPaletteScope>;
}

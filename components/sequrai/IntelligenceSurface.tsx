import { cn } from "@/lib/utils";
import { radius, surface } from "@/lib/design-system/tokens";

type IntelligenceSurfaceProps = {
  children: React.ReactNode;
  className?: string;
  toneClass?: string;
  id?: string;
  "aria-labelledby"?: string;
  as?: "section" | "article" | "div";
};

/** Primary elevated surface for intelligence/decision UI. */
export function IntelligenceSurface({
  children,
  className,
  toneClass,
  id,
  "aria-labelledby": ariaLabelledby,
  as: Tag = "section",
}: IntelligenceSurfaceProps) {
  return (
    <Tag
      id={id}
      aria-labelledby={ariaLabelledby}
      className={cn(radius.xl, "border p-8 sm:p-10", surface.base, "seq-transition", toneClass, className)}
    >
      {children}
    </Tag>
  );
}

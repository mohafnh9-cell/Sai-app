"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function MissionControlError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    console.error("Mission Control render failed", error);
  }, [error]);

  return (
    <div className="app-cinematic-bg min-h-full flex flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Mission Control couldn&apos;t load</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong while loading your Production Verdict. Try again, or open the latest
          review without a historical run.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href={pathname}>Open latest review</Link>
        </Button>
      </div>
    </div>
  );
}

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ConnectRedirect } from "./ConnectRedirect";

export default function ConnectPage() {
  return (
    <Suspense
      fallback={
        <div className="flex w-full max-w-sm justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <ConnectRedirect />
    </Suspense>
  );
}

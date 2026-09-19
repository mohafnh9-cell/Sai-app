import { Suspense } from "react";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm h-96 animate-pulse rounded-lg bg-muted/30" />}>
      <SignupForm />
    </Suspense>
  );
}

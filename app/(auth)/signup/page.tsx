import { redirect } from "next/navigation";
import { SignupForm } from "./SignupForm";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;

  if (params.email !== "1") {
    redirect("/connect");
  }

  return <SignupForm />;
}

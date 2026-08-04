import { redirect } from "next/navigation";

/** Legacy org timeline — redirect to Mission Control home. */
export default function TimelinePage() {
  redirect("/dashboard");
}

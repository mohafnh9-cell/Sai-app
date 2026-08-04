import { redirect } from "next/navigation";

/** Legacy global Safe Fix inbox — redirect to Projects. */
export default function AIFixesPage() {
  redirect("/projects");
}

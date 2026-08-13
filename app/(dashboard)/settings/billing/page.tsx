import { redirect } from "next/navigation";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";

export default function SettingsBillingRedirect() {
  redirect(isBillingEnabled() ? "/billing" : "/settings");
}

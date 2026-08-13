import "server-only";

import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { getOrganizationSubscription } from "@/server/billing/subscription-status";
import { enforceRateLimit } from "@/server/http/rate-limit";

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    limit: 5,
    windowMs: 60_000,
    keyPrefix: "account-delete",
  });
  if (rateLimited) return rateLimited;

  const auth = await getServerAuthContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { confirmation?: string };
  try {
    body = (await request.json()) as { confirmation?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.confirmation?.trim().toUpperCase() !== "DELETE") {
    return NextResponse.json({ error: "Confirmation must be DELETE" }, { status: 400 });
  }

  const admin = createAdminClient();
  const organizationId = auth.organizationId;

  if (organizationId) {
    const subscription = await getOrganizationSubscription(auth.supabase, organizationId);

    if (subscription?.stripeSubscriptionId && isStripeConfigured()) {
      try {
        const stripe = getStripe();
        await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
      } catch (error) {
        console.error({
          component: "account-delete",
          step: "stripe-cancel",
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    const { count: memberCount } = await admin
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);

    const { data: ownerMembership } = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (ownerMembership?.role === "OWNER" && (memberCount ?? 0) <= 1) {
      await admin.from("mcp_api_keys").delete().eq("organization_id", organizationId);
      await admin.from("organizations").delete().eq("id", organizationId);
    } else {
      await admin
        .from("organization_members")
        .delete()
        .eq("organization_id", organizationId)
        .eq("user_id", auth.user.id);
    }
  }

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(auth.user.id);
  if (deleteUserError) {
    return NextResponse.json({ error: deleteUserError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

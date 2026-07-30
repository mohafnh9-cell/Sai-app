import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/server/http/rate-limit";

const bodySchema = z.object({}).strict();

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase.auth.updateUser({
    data: {
      ...user.user_metadata,
      onboarding_wizard_completed_at: new Date().toISOString(),
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

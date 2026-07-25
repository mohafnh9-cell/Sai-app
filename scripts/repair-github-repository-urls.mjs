#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectId = process.argv.find((arg) => arg.startsWith("--project="))?.slice("--project=".length);

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

function normalizeStored(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  const path = trimmed.replace(/^https:\/\/github\.com\//i, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === parts[1]) {
    return `https://github.com/${parts[0]}/${parts[2]}`;
  }
  if (parts.length === 2) {
    return `https://github.com/${parts[0]}/${parts[1]}`;
  }
  return trimmed.startsWith("http") ? trimmed : null;
}

let query = admin.from("projects").select("id, github_repo").not("github_repo", "is", null);
if (projectId) query = query.eq("id", projectId);

const { data, error } = await query;
if (error) {
  console.error(error.message);
  process.exit(1);
}

const repairs = [];
for (const row of data ?? []) {
  const current = row.github_repo;
  const normalized = normalizeStored(current);
  if (!normalized || normalized === current) continue;
  const { error: updateError } = await admin
    .from("projects")
    .update({ github_repo: normalized, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (updateError) {
    console.error(updateError.message);
    process.exit(1);
  }
  repairs.push({ projectId: row.id, previous: current, next: normalized });
}

console.log(JSON.stringify({ repaired: repairs.length, repairs }, null, 2));

-- Track when an MCP API key was first actually used, so setup duration
-- (created_at -> first_used_at) can be measured with real data. last_used_at
-- is overwritten on every call, so it can't answer "how long did setup take".
begin;

alter table public.mcp_api_keys
  add column if not exists first_used_at timestamptz;

commit;

-- MCP OAuth: a pre-registered PUBLIC client for the supervised pilot's Claude Code test.
--
-- NOT applied automatically. Exact redirect URI, fixed port, no wildcard:
--   Claude Code (>= 2.1.231) sends http://localhost:PORT/callback when started with --callback-port / oauth.callbackPort.
-- Dynamic client registration stays DISABLED and no scope policy changes: what a connection is granted is still decided at consent
-- (sensitive scopes are opt-in), and the client can only be used with this exact loopback redirect.
--
-- Retire it when the test ends:  update public.mcp_oauth_clients set status = 'disabled', updated_at = now()
--                                 where client_id = 'sequrai-claude-code-pilot';
begin;

insert into public.mcp_oauth_clients (client_id, client_name, client_type, redirect_uris, status)
values (
  'sequrai-claude-code-pilot',
  'Claude Code (pilot test, local)',
  'public',
  array['http://localhost:43871/callback'],
  'active'
)
on conflict (client_id) do nothing;

commit;

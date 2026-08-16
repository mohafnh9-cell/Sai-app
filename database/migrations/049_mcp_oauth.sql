-- Fase C: MCP OAuth 2.1 + PKCE for remote MCP
-- Tokens and authorization codes are stored as SHA-256 hashes only.
begin;

-- ─── OAuth clients (pre-registered + optional DCR) ───────────────────────────

create table if not exists public.mcp_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_name text not null,
  client_type text not null default 'public'
    check (client_type in ('public', 'confidential')),
  redirect_uris text[] not null default '{}',
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_clients_status
  on public.mcp_oauth_clients (client_id)
  where status = 'active';

-- ─── Pending authorization requests (consent flow) ─────────────────────────

create table if not exists public.mcp_oauth_authorization_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.mcp_oauth_clients (client_id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  redirect_uri text not null,
  scopes text[] not null default '{}',
  code_challenge text not null,
  code_challenge_method text not null default 'S256'
    check (code_challenge_method = 'S256'),
  state text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_auth_requests_user
  on public.mcp_oauth_authorization_requests (user_id, created_at desc);

create index if not exists idx_mcp_oauth_auth_requests_expires
  on public.mcp_oauth_authorization_requests (expires_at);

-- ─── Authorization codes (single-use, PKCE-bound) ──────────────────────────

create table if not exists public.mcp_oauth_authorization_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  client_id text not null references public.mcp_oauth_clients (client_id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256'
    check (code_challenge_method = 'S256'),
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_codes_hash_active
  on public.mcp_oauth_authorization_codes (code_hash)
  where consumed_at is null;

create index if not exists idx_mcp_oauth_codes_expires
  on public.mcp_oauth_authorization_codes (expires_at);

-- ─── Access tokens (opaque, hashed) ────────────────────────────────────────

create table if not exists public.mcp_oauth_access_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  client_id text not null references public.mcp_oauth_clients (client_id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_access_tokens_hash_active
  on public.mcp_oauth_access_tokens (token_hash)
  where revoked_at is null;

create index if not exists idx_mcp_oauth_access_tokens_org
  on public.mcp_oauth_access_tokens (organization_id, created_at desc);

create index if not exists idx_mcp_oauth_access_tokens_expires
  on public.mcp_oauth_access_tokens (expires_at);

-- ─── Refresh tokens (rotation + family revocation) ─────────────────────────

create table if not exists public.mcp_oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  client_id text not null references public.mcp_oauth_clients (client_id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  family_id uuid not null,
  rotated_from uuid references public.mcp_oauth_refresh_tokens (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_refresh_tokens_hash_active
  on public.mcp_oauth_refresh_tokens (token_hash)
  where revoked_at is null;

create index if not exists idx_mcp_oauth_refresh_tokens_family
  on public.mcp_oauth_refresh_tokens (family_id);

-- ─── RLS: service-role only for token resolution (no client-side access) ───

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_authorization_requests enable row level security;
alter table public.mcp_oauth_authorization_codes enable row level security;
alter table public.mcp_oauth_access_tokens enable row level security;
alter table public.mcp_oauth_refresh_tokens enable row level security;

-- Members may read active OAuth client metadata (for consent UI display names).
drop policy if exists "Members read active oauth clients" on public.mcp_oauth_clients;
create policy "Members read active oauth clients"
  on public.mcp_oauth_clients for select
  using (status = 'active');

-- Users manage their own pending authorization requests.
drop policy if exists "Users manage own oauth auth requests" on public.mcp_oauth_authorization_requests;
create policy "Users manage own oauth auth requests"
  on public.mcp_oauth_authorization_requests for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No direct client access to codes, access tokens, or refresh tokens.

-- ─── Pre-registered MCP clients (beta + local inspector) ───────────────────
-- Redirect URIs use exact-match validation. Extend only with verified URIs.

insert into public.mcp_oauth_clients (client_id, client_name, client_type, redirect_uris, status)
values
  (
    'sequrai-mcp-inspector',
    'MCP Inspector (development)',
    'public',
    array[
      'http://127.0.0.1:6274/oauth/callback',
      'http://localhost:6274/oauth/callback'
    ],
    'active'
  ),
  (
    'sequrai-claude-desktop',
    'Claude Desktop',
    'public',
    array[
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback'
    ],
    'active'
  ),
  (
    'sequrai-chatgpt',
    'ChatGPT',
    'public',
    array[
      'https://chatgpt.com/connector_platform_oauth_redirect',
      'https://chat.openai.com/connector_platform_oauth_redirect'
    ],
    'active'
  )
on conflict (client_id) do nothing;

commit;

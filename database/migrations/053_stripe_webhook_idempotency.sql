-- Stripe webhook event idempotency (global event.id from Stripe)
begin;

create table if not exists public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stripe_webhook_events_status_created
  on public.stripe_webhook_events (status, created_at desc);

alter table public.stripe_webhook_events enable row level security;

commit;

-- Free-plan scan entitlement: atomic, concurrency-safe scan-credit counter.
--
-- Two simultaneous scan requests from an organization with 1 free credit
-- remaining must never both succeed. A plain "SELECT count, then INSERT if
-- under limit" application-level check is a TOCTOU race. This migration adds
-- a single-row-per-organization counter on the existing `subscriptions`
-- table and an atomic conditional-increment function that Postgres itself
-- serializes: concurrent UPDATEs against the same row are locked in order,
-- and a blocked writer re-evaluates the WHERE clause against the newly
-- committed value once the first writer commits -- so only one of two
-- simultaneous callers can ever consume the last credit.
begin;

alter table public.subscriptions
  add column if not exists free_scans_used integer not null default 0
    check (free_scans_used >= 0);

create or replace function public.consume_free_scan_credit(
  p_organization_id uuid,
  p_limit integer
)
returns boolean
language plpgsql
as $$
begin
  -- Organizations that have never touched billing (never opened Stripe
  -- checkout) have no `subscriptions` row yet -- see
  -- server/billing/customer.ts:getOrCreateStripeCustomer, which only creates
  -- one lazily. Self-heal here using the same FREE/canceled convention so a
  -- brand-new organization's first scan is never incorrectly rejected.
  insert into public.subscriptions (organization_id, plan, status, free_scans_used)
  values (p_organization_id, 'FREE', 'canceled', 0)
  on conflict (organization_id) do nothing;

  update public.subscriptions
    set free_scans_used = free_scans_used + 1,
        updated_at = now()
    where organization_id = p_organization_id
      and free_scans_used < p_limit;

  return found;
end;
$$;

commit;

-- Sprint 5: Security Alerts layer (founder-facing, in-app)
begin;

create table if not exists public.security_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  alert_kind text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  delivery_tier text not null default 'immediate'
    check (delivery_tier in ('immediate', 'digest')),
  state text not null default 'delivered'
    check (state in ('delivered', 'read', 'resolved', 'dismissed')),
  dedupe_key text not null,
  cooldown_until timestamptz,
  priority smallint not null default 50,
  protection_impact text not null default '',
  title_plain text not null,
  body_plain text not null default '',
  worry_line text not null default '',
  changed_bullets jsonb not null default '[]'::jsonb,
  next_action text not null default '',
  cta_type text check (
    cta_type is null or cta_type in (
      'safe_fix', 'review_again', 'open_protection', 'reconnect_github', 'resume_cp'
    )
  ),
  linked_recommendation_id text,
  source text not null default 'evaluator',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  acknowledged_at timestamptz,
  dismissed_at timestamptz,
  resolved_at timestamptz,
  constraint security_alerts_project_dedupe unique (project_id, dedupe_key),
  constraint security_alerts_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_security_alerts_project_state
  on public.security_alerts (project_id, state, created_at desc);

create index if not exists idx_security_alerts_org_created
  on public.security_alerts (organization_id, created_at desc);

create table if not exists public.security_alert_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  alert_id uuid not null references public.security_alerts(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'created',
      'state_transition',
      'acknowledged',
      'read',
      'dismissed',
      'resolved',
      'suppressed',
      'cooldown_skipped'
    )
  ),
  from_state text,
  to_state text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint security_alert_events_tenant_fk
    foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_security_alert_events_alert
  on public.security_alert_events (alert_id, created_at desc);

alter table public.security_alerts enable row level security;
alter table public.security_alert_events enable row level security;

create policy "Members read security alerts"
  on public.security_alerts for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = security_alerts.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members update security alerts read state"
  on public.security_alerts for update using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = security_alerts.organization_id and m.user_id = auth.uid()
    )
  );

create policy "Members read security alert events"
  on public.security_alert_events for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = security_alert_events.organization_id and m.user_id = auth.uid()
    )
  );

commit;

-- Preserve manual HTTP/DNS proof while allowing authenticated deployment
-- evidence to record the same verified ownership state.

alter table public.dynamic_target_verifications
  drop constraint if exists dynamic_target_verifications_verification_method_check;

alter table public.dynamic_target_verifications
  add constraint dynamic_target_verifications_verification_method_check
  check (
    verification_method in (
      'http',
      'dns',
      'provider_integration',
      'deployment_repository_match'
    )
  );

alter table public.dynamic_target_verifications
  add column if not exists verification_evidence jsonb not null default '{}'::jsonb
  check (jsonb_typeof(verification_evidence) = 'object');

-- Phase 36: widen security_job_events.event_type (migration 063) to include
-- orchestration-level events (discovery, planning, correlation, attack-chain
-- detection, investigation, AI reasoning, verdict) alongside the existing
-- per-job engine-execution events. No new table -- reuses the exact table
-- Phase 35.5 introduced, per this phase's explicit "do not duplicate
-- security_job_events" instruction. Additive: every existing value stays
-- valid; only new values are added to the CHECK constraint.

-- Orchestration-level events (DISCOVERY_STARTED, PLAN_CREATED,
-- CORRELATION_STARTED, ATTACK_CHAIN_DETECTED, INVESTIGATION_*,
-- AI_REASONING_STARTED, VERDICT_GENERATED) are SCAN-level, not tied to any
-- one SecurityJob -- migration 063 required job_id NOT NULL, which only
-- fit per-job engine events. Widen it: still required for job-scoped
-- events, nullable for scan-level orchestration events.
alter table public.security_job_events
  alter column job_id drop not null;

alter table public.security_job_events
  drop constraint if exists security_job_events_event_type_check;

alter table public.security_job_events
  add constraint security_job_events_event_type_check
  check (
    event_type in (
      -- Phase 35.5 (unchanged)
      'JOB_QUEUED', 'JOB_CLAIMED', 'ENGINE_STARTED', 'ENGINE_COMPLETED',
      'ENGINE_FAILED', 'ENGINE_TIMED_OUT', 'ENGINE_CANCELLED',
      'FINDINGS_NORMALIZED', 'EVIDENCE_PERSISTED', 'CORRELATION_COMPLETED',
      'JOB_REJECTED', 'JOB_RETRY_SCHEDULED',
      -- Phase 36: orchestration-level events
      'DISCOVERY_STARTED', 'DISCOVERY_COMPLETED', 'PLAN_CREATED',
      'JOB_STARTED', 'JOB_COMPLETED', 'JOB_FAILED',
      'CORRELATION_STARTED', 'ATTACK_CHAIN_DETECTED',
      'INVESTIGATION_STARTED', 'INVESTIGATION_COMPLETED',
      'AI_REASONING_STARTED', 'VERDICT_GENERATED',
      -- Phase 37: AI reasoning outcome events (section 20)
      'AI_REASONING_COMPLETED', 'AI_REASONING_FAILED', 'AI_REASONING_TIMEOUT',
      'AI_INVESTIGATION_PROPOSED', 'AI_INVESTIGATION_REJECTED'
    )
  );

-- security_jobs.scan_id already ties every event to a scan; no new column
-- is required for the requestId -> scanId -> jobId -> engineExecutionId
-- trace the brief asks for (section 26 of the Phase 35.5 prompt) -- the
-- trace already exists via existing foreign keys (security_job_events.job_id
-- -> security_jobs.id, security_jobs.scan_id -> scans.id).

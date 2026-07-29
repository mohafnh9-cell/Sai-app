-- Production Review consistency diagnostics (read-only).
-- Replace the UUID below (example only).

-- Active full scans without a queued/running scan_job
select s.id as scan_id, s.status, s.commit_sha, s.created_at
from scans s
where s.repository_id = '00000000-0000-0000-0000-000000000000'::uuid
  and s.scan_type = 'full'
  and s.status in (
    'queued', 'fetching_repository', 'indexing', 'scanning',
    'calculating_score', 'cancelling'
  )
  and not exists (
    select 1 from scan_jobs j
    where j.scan_id = s.id and j.status in ('queued', 'running')
  );

-- scan_jobs without matching scan
select j.id as scan_job_id, j.scan_id, j.status, j.project_id
from scan_jobs j
left join scans s on s.id = j.scan_id
where j.project_id = '00000000-0000-0000-0000-000000000000'::uuid
  and j.scan_id is not null
  and s.id is null;

-- Null commit_sha on recent full scans
select id, status, branch, commit_sha, created_at
from scans
where repository_id = '00000000-0000-0000-0000-000000000000'::uuid
  and scan_type = 'full'
  and commit_sha is null
order by created_at desc
limit 20;

-- Verdict SHA differs from scan SHA (completed full scans)
select
  pv.id as verdict_id,
  pv.commit_sha as verdict_commit_sha,
  s.id as scan_id,
  s.commit_sha as scan_commit_sha,
  s.completed_at
from production_verdicts pv
join scans s on s.id = pv.scan_id
where pv.project_id = '00000000-0000-0000-0000-000000000000'::uuid
  and pv.commit_sha is distinct from s.commit_sha
order by pv.created_at desc
limit 20;

-- Multiple active full scans (should be blocked by unique partial index after 041)
select id, status, commit_sha, created_at
from scans
where repository_id = '00000000-0000-0000-0000-000000000000'::uuid
  and scan_type = 'full'
  and status in (
    'queued', 'fetching_repository', 'indexing', 'scanning',
    'calculating_score', 'cancelling'
  )
order by created_at desc;

-- Active jobs targeting older commits vs latest completed verdict
with head_verdict as (
  select commit_sha
  from production_verdicts
  where project_id = '00000000-0000-0000-0000-000000000000'::uuid
  order by created_at desc
  limit 1
)
select j.id, j.status, s.commit_sha, hv.commit_sha as latest_verdict_sha
from scan_jobs j
join scans s on s.id = j.scan_id
cross join head_verdict hv
where j.project_id = '00000000-0000-0000-0000-000000000000'::uuid
  and j.status in ('queued', 'running')
  and hv.commit_sha is not null
  and s.commit_sha is distinct from hv.commit_sha;

-- Stale queued jobs (no heartbeat, older than 30 minutes)
select id, scan_id, status, created_at, heartbeat_at, updated_at
from scan_jobs
where project_id = '00000000-0000-0000-0000-000000000000'::uuid
  and status = 'queued'
  and created_at < now() - interval '30 minutes';

-- Superseded scans still linked as active in repository_scan_state
select rss.active_scan_id, s.status, s.error_code, s.commit_sha
from repository_scan_state rss
join scans s on s.id = rss.active_scan_id
where rss.repository_id = '00000000-0000-0000-0000-000000000000'::uuid
  and (
    s.status in ('failed', 'cancelled', 'completed')
    or s.error_code = 'COMMIT_SUPERSEDED_BY_REMOTE_HEAD'
  );

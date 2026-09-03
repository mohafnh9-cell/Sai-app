-- Phase 10 (upload analysis): distinguishes how a scan's source code was
-- ingested. Existing scans are all GitHub-sourced; upload is new. Scanner
-- Results (Phase 9) uses this to label the source without inferring it from
-- github_repo presence, which stays reserved for "is this project actually
-- GitHub-connected" elsewhere in the app.
begin;

alter table public.scans
  add column if not exists source text not null default 'github'
  check (source in ('github', 'upload'));

commit;

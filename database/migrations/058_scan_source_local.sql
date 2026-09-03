-- Phase 11 (local analysis): adds "local" as a third scan source alongside
-- the "github"/"upload" values 057 introduced. Local Analysis is browser
-- directory-picker ingestion (Phase 10's ZIP-upload sibling) and is
-- conceptually distinct from a ZIP upload for Scanner Results' "Source"
-- label, even though both converge into the identical scan pipeline.
begin;

alter table public.scans drop constraint if exists scans_source_check;

alter table public.scans
  add constraint scans_source_check check (source in ('github', 'upload', 'local'));

commit;

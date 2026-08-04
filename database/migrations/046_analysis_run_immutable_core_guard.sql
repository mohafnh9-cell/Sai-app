-- Sprint 6: Hard block on core scan mutations after immutability lock
begin;

create or replace function public.prevent_immutable_scan_core_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.immutability_locked_at is not null then
    if to_jsonb(new) - 'metrics' - 'updated_at'
       is distinct from to_jsonb(old) - 'metrics' - 'updated_at' then
      raise exception 'analysis_run_immutable: scan % is locked', old.id
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_scans_prevent_immutable_core on public.scans;

create trigger trg_scans_prevent_immutable_core
  before update on public.scans
  for each row
  execute function public.prevent_immutable_scan_core_mutation();

commit;

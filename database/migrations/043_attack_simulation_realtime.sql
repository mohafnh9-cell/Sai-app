-- Slice 8: enable Supabase Realtime for Attack Simulation live UI.
begin;

do $$
begin
  alter publication supabase_realtime add table public.attack_simulation_campaigns;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.attack_simulation_runtime_events;
exception
  when duplicate_object then null;
end $$;

commit;

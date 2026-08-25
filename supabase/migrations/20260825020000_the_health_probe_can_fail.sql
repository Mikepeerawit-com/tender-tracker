-- The health probe can fail.
--
-- `health_check()` answers one question — "does Postgres answer?" — and it is defined in
-- the *first* migration, so it answers `true` for every possible state of migrations
-- 2..N. The hosted database ran three weeks eight migrations behind, with no application
-- tables at all, and `/api/health` said `ok` the whole time. Then CI went red on
-- `permission denied for table orgs` for a month, and the probe said `ok` through that
-- too, because `health_check()` is a function and needs no table privilege to run.
--
-- Two faults, one week apart, both invisible to the same check. That is not a check that
-- failed; it is a check that *cannot* fail, which is the silent-failure class ADR-0005
-- exists to refuse. This function is the one that can.
--
-- It answers the two questions `health_check()` structurally cannot:
--
--   1. **Which migrations does this database actually hold?** Returned as the whole list,
--      not the newest one. A max comparison sees a tail that is behind and misses a gap
--      in the middle, which is exactly the shape `migration repair` leaves behind.
--   2. **Can the app read its own tables?** Answered by really reading one, not by
--      inspecting a catalogue — `has_table_privilege` would have agreed the grants were
--      fine right up until the image bump that removed them.

-- `service_role` cannot read the migration history by default, and it is the role the
-- probe arrives on. This is the whole privilege: a list of version strings.
grant usage on schema supabase_migrations to service_role;
grant select on supabase_migrations.schema_migrations to service_role;

-- Deliberately SECURITY INVOKER, and deliberately not one function per question.
--
-- The table read has to happen as `authenticated`, because that is the role every user
-- facing screen reads on and the role whose grants went missing. Postgres refuses
-- `set role` inside a SECURITY DEFINER function outright, so the two halves cannot both
-- be definer-owned; and reading the migration history needs a privilege `service_role`
-- did not have, which the grant above now supplies. Invoker plus that grant is what lets
-- one function answer both, on one round trip.
--
-- The `reset role` is the load-bearing line and the reason for the grant at the bottom.
-- PostgREST connects as `authenticator` and does `set local role service_role`; only
-- `authenticator` is a member of `authenticated`, so stepping back to the session role is
-- the only way down to it. That is a role hop, and a role hop reachable by `anon` would
-- be an escalation — so EXECUTE is `service_role` only. What the hop can do is fixed by
-- the body below and returns no row data, only whether reading succeeded.
create function public.health_probe()
returns jsonb
language plpgsql
as $$
declare
  -- Restored before returning: `set local` outlives this function to the end of the
  -- transaction, and leaving a caller silently downgraded is its own silent failure.
  caller   text := current_user;
  applied  text[];
  readable jsonb;
begin
  select coalesce(array_agg(version order by version), '{}')
    into applied
    from supabase_migrations.schema_migrations;

  begin
    reset role;
    set local role authenticated;

    -- One row from one table, under the role a screen reads on. RLS still applies and
    -- there is no session, so `current_org_id()` is null and this matches nothing —
    -- zero rows is the healthy answer. A missing *privilege* raises 42501 instead, and
    -- a missing *table* raises 42P01, which is how a database with no schema at all
    -- tells itself apart from one that merely cannot be read.
    --
    -- One table is enough because the fault this catches is a schema-wide one: table
    -- privileges came from a bootstrap default that either grants across `public` or
    -- does not. `tenders` is the one every screen turns on, and the dashboard is empty
    -- without it.
    perform 1 from public.tenders limit 1;

    readable := jsonb_build_object('probed', 'tenders', 'readable', true);
  exception when others then
    readable := jsonb_build_object(
      'probed', 'tenders', 'readable', false, 'error', sqlstate
    );
  end;

  execute format('set local role %I', caller);

  return jsonb_build_object('applied', applied, 'tables', readable);
end
$$;

comment on function public.health_probe() is
  'Schema state for /api/health: every applied migration version, and whether one real table can still be read as `authenticated`. `health_check()` answers neither and cannot be made to.';

revoke all on function public.health_probe() from public;
grant execute on function public.health_probe() to service_role;

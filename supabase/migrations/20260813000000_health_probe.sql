-- The health probe.
--
-- Deliberately *not* part of the v1 schema (see the schema migration): this function
-- exists so a deployment can be asked "is Postgres actually reachable?" over the same
-- client library the app uses everywhere else, without depending on any domain table.
-- The /api/health route handler calls it; the test seam calls that handler.

create function public.health_check()
returns boolean
language sql
stable
as $$ select true $$;

comment on function public.health_check() is
  'Liveness probe for /api/health. Returns true if Postgres answered.';

revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated, service_role;

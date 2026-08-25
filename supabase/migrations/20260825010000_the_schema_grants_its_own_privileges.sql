-- The schema grants its own table privileges instead of inheriting them.
--
-- Every table in this schema was reachable only by accident. Not one `grant` on a table
-- was ever written; access came entirely from the `alter default privileges` Supabase's
-- own bootstrap sets on `public`, which historically handed `anon`, `authenticated` and
-- `service_role` full DML on anything created there. Newer Supabase images stopped doing
-- that — new tables now come with `truncate, references, trigger` and no DML at all — and
-- from that moment every query in the app answers `permission denied for table orgs`.
--
-- This is why CI has been red since the v1 schema landed: the workflow pins a newer CLI
-- than developers run locally, so the whole suite failed there and passed on every
-- machine. The database was one image bump away from being unreadable in production too.
--
-- RLS answers "which rows"; GRANT answers "which tables, and which verbs". The schema
-- already states the first half itself and left the second to a default it did not
-- control. Both halves are now written down here, in the same shape.
--
-- **The grants below mirror the policies exactly, and are deliberately not broader.**
-- Where a later migration narrowed something, the narrowing is preserved rather than
-- undone — this migration runs *after* those revokes, so a blanket grant here would
-- quietly reopen every door they closed.

-- The service role is the cron and the admin paths. It bypasses RLS by design and is
-- never exposed to a browser, so it gets everything, on everything.
grant select, insert, update, delete on all tables in schema public to service_role;

-- `for all to authenticated` in the policy block: the org's own business data, with RLS
-- doing the scoping. One list, matching that loop table for table.
grant select, insert, update, delete on table
  public.suppliers,
  public.tenders,
  public.tender_assignees,
  public.tender_items,
  public.quotes,
  public.quote_photos,
  public.reference_images,
  public.no_supplier_found,
  public.reminders,
  public.notifications
to authenticated;

-- `orgs` and `users` carry the same `for all` policy but were narrowed by
-- 20260814010000 and 20260814030000: membership is not business data, and a `users` row
-- is your own. Read-only at the table level is what those migrations left behind, and
-- `users` keeps its separate `update (name, locale)` column grant untouched.
grant select on table public.orgs, public.users to authenticated;

-- Reference data with no owner, and a read-only policy to match. The only legitimate
-- writer is the Frankfurter fetch, which runs as the service role above; a write grant
-- here would hand the browser's key an edit on the rate every future Quote freezes at.
grant select on table public.fx_rates to authenticated;

-- Deliberately absent, and each for a reason already argued in the migration that closed
-- it: `tender_reference_counters` (20260814020000 — the counter is the trigger's, not the
-- caller's) and `group_robots` (20260821000000 — the webhook is a bearer credential and
-- the only reader is the send path on the service role).
--
-- `anon` is absent too, and this is the one place the newer default is an improvement
-- worth keeping. Every policy in this schema is `to authenticated`, so the anon key
-- already matched no row anywhere; it simply held table privileges it could never use.
-- Having lost them, it does not get them back here.

-- Future tables do not inherit any of this. That is the point: the next migration to add
-- a table must grant for it, in the same breath as it writes its policy, or the table is
-- unreachable and its own tests say so on the first run.

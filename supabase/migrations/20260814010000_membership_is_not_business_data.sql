-- Membership is not business data.
--
-- The v1 RLS posture is one policy per table: inside your org you read and write
-- everything, cost and margin included. That is deliberate and it is right for the
-- business data — under ten trusted users, everyone is permitted to see everything.
--
-- Three columns cannot live under it, and the conflict is inside the spec rather than
-- introduced here. A6 says "no column-level rules". Story 48 says the Org Admin is the
-- only person who can invite, and buildspec_2.md:154 says `is_org_admin` is what gates
-- inviting. A boolean you can set on yourself is not a gate: `update users set
-- is_org_admin = true where id = auth.uid()` is one line from the browser console, and
-- the anon key needed to send it is already there.
--
-- A6 is about *visibility* — no hiding cost, price or margin from a colleague. That
-- reading is preserved exactly. What changes is who may write three columns that are
-- not business data at all:
--
--   * `is_org_admin` — the invite gate.
--   * `disabled_at`  — the readmission gate. A disabled user cannot clear it (they read
--                      nothing), but before this every remaining member could.
--   * `org_id`       — the boundary the whole policy is written in terms of.
--
-- Column privileges are the right layer: RLS answers "which rows", GRANT answers
-- "which columns", and the two compose without making the policy conditional.

revoke insert, update, delete on public.users from authenticated;

-- What is left is a member editing their own profile. `name` and `locale` are theirs to
-- change; `locale` in particular is written on first start-up by the user themselves.
-- Everything else about a `users` row — creating one, disabling one, promoting one,
-- setting a `wecom_userid` from the WeCom console — goes through a server action that
-- checks `is_org_admin` first and then writes with the service role.
grant update (name, locale) on public.users to authenticated;

comment on column public.users.is_org_admin is
  'Gates inviting and nothing else; it confers no extra visibility. Not writable by `authenticated` at all — see the column grants in this migration. True for exactly one row.';

-- Users are never deleted, only soft-disabled: a Quote records who sourced it, and that
-- attribution has to survive someone leaving. The FK from `users.id` to `auth.users` is
-- `on delete restrict` for the same reason; this closes the other direction.

-- `orgs` is settings, not business data either, and no v1 screen edits it. `timezone`
-- moves every date boundary in the app at once and `fx_buffer_pct` silently re-prices
-- every future Quote, so neither should be one PostgREST call from any signed-in
-- browser. Reads stay open — the app needs both on nearly every page.
revoke insert, update, delete on public.orgs from authenticated;

-- A `users` row is your own.
--
-- The previous migration settled *which columns* a member may write on `users` — `name`
-- and `locale`, nothing else — and left "whose row" to the one policy on the table:
--
--   org_members_full_access ... using (org_id = public.current_org_id())
--
-- which is every colleague's row. Column privileges and RLS answer different questions,
-- and only one of them had been asked. So `name` and `locale` were two of the *org's*
-- columns rather than two of your own: one PostgREST call from any signed-in browser
--
--   PATCH /rest/v1/users?id=eq.<colleague> { "locale": "zh-Hans" }
--
-- and a colleague's app comes back in the other language on next load, with nothing to
-- say why. Renaming them is the same call.
--
-- The fix is a RESTRICTIVE policy, which ANDs with the permissive one rather than
-- replacing it: `users` stays fully readable across the org — A6 is about visibility and
-- nothing here narrows it — while an UPDATE has to be aimed at your own row as well as
-- your own org.
--
-- Scoped `for update` on purpose. SELECT keeps the org-wide rule; INSERT and DELETE were
-- revoked outright in the previous migration and need no row rule to sit on top.
create policy users_edit_only_your_own_row on public.users
  as restrictive
  for update
  to authenticated
  -- `select auth.uid()` rather than a bare call so the planner evaluates it once for the
  -- statement instead of once per row.
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

comment on policy users_edit_only_your_own_row on public.users is
  'RESTRICTIVE, so it ANDs with org_members_full_access: reading stays org-wide, writing is your own row. The column grants say `name` and `locale` are the only columns; this says whose.';

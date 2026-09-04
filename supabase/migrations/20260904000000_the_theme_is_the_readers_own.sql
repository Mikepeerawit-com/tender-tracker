-- The theme is the reader's own, on the reader's own row.
--
-- A dark palette has been fully defined in `globals.css` since #130 and nothing in the
-- app has ever turned it on. #133 gives a member the switch, and this is where the answer
-- is kept: on `users`, beside `locale`, because it is the same kind of fact — what this
-- app is *for one person*, which has to survive the phone it was chosen on
-- (ADR-0024). A device-level answer was the alternative and it is the one the ADR argues
-- against; a column is what choosing per user costs.
--
-- **`locale`'s posture exactly, with one deliberate difference.** `locale` is nullable
-- because first start-up *asks* rather than inferring, and `/choose-language` stands in
-- front of the app until it has an answer. Nothing asks about a theme and nothing should:
-- there is an answer that needs no question — follow the device — so the column is `not
-- null default 'system'` and every existing row already holds it.
--
-- `'system'` is a stored value rather than a null meaning "unset", because it is a real
-- choice a member can come back *to*: pinning dark on a phone and then returning to
-- System is a thing they did, and a null could not tell it from never having been asked.
alter table public.users
  add column theme text not null default 'system'
    check (theme in ('system', 'light', 'dark'));

comment on column users.theme is
  'System, light or dark — the reader''s own, and stored per user rather than per device (ADR-0024). `system` follows the operating system and is what a row holds until somebody pins one of the other two.';

-- Which columns a member may write, extended by one. `grant update (name, locale)` in
-- 20260814010000 is the list this joins; column privileges accumulate, so this adds
-- `theme` to it rather than replacing it.
--
-- **Whose row is already answered** and is deliberately not re-answered here.
-- `users_edit_only_your_own_row` (20260814030000) is RESTRICTIVE, `for update`, and names
-- no column at all — so it ANDs with the org-wide policy for every column on the table,
-- including one added years later. A new writable column joins that rule by existing;
-- what it does *not* join by existing is this grant, which is why a column added without
-- this line is silently unwritable and one added without the policy would have been
-- silently writable by every colleague. Both halves are asserted in `rls.test.ts`.
grant update (theme) on public.users to authenticated;

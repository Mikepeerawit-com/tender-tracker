-- `quotes.updated_at` shipped with a default and nothing to maintain it. Until now that
-- was inert rather than wrong: nothing wrote a Quote row after the insert, so every row
-- still had `updated_at` equal to `created_at` and the column told no lie.
--
-- #55 gives a Quote an edit path, which is the moment the column would start lying — it
-- would read "last edited" and go on meaning "created". So the trigger arrives with the
-- edit rather than in a ticket of its own, the same way `touch_updated_at` arrived with
-- editing a Tender.
--
-- The database owns the timestamp rather than the app: it records when a row changed,
-- which is a fact about the row, not one of the org-timezone date boundaries ADR-0010
-- makes the caller choose.
create trigger quotes_touch_updated_at
  before update on quotes
  for each row execute function public.touch_updated_at();

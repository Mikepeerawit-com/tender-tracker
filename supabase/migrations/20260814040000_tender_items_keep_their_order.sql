-- Tender Items keep the order they were entered in.
--
-- A Tender's Items are a list somebody typed: gloves, then masks, then gowns, in the
-- order the client's request asks for them. Nothing was storing that. `createTender`
-- inserts every Item in a single statement, and `now()` is transaction-stable, so all of
-- them carry the *same* `created_at` to the microsecond — `order by created_at` has no
-- tiebreak left and falls through to heap order. Postgres rewrites an updated row at the
-- end of the heap, so editing one Item moved it to the bottom of the list:
--
--   insert into probe (name) values ('a'),('b'),('c');  -- one created_at for all three
--   select name from probe order by created_at;         -- a, b, c
--   update probe set name = name where name = 'a';
--   select name from probe order by created_at;         -- b, c, a
--
-- `id` is no fix: it is a random uuid, so it would make the order *stable* and still not
-- the order anybody typed. The position has to be stored, because it is a fact about the
-- Tender rather than a by-product of how the rows were written.
alter table tender_items add column ordinal integer;

-- Existing rows keep the order they currently read in, which is the order they were
-- entered: nothing has been edited in production yet, so `created_at` is still true here.
update tender_items item
set ordinal = ranked.place
from (
  select id, (row_number() over (partition by tender_id order by created_at, id)) - 1 as place
  from tender_items
) ranked
where ranked.id = item.id;

-- No default. An Item with no place in the list is a bug in whoever inserted it, and a
-- default of 0 would hide it by quietly stacking every new Item on top of the first.
alter table tender_items alter column ordinal set not null;

comment on column tender_items.ordinal is
  'The Item''s place in the Tender, from 0, in the order it was entered. Ties are possible — two concurrent adds can read the same max — so readers sort by (ordinal, id) and never on ordinal alone.';

-- Every read of a Tender's Items sorts by this.
create index tender_items_in_order on tender_items (tender_id, ordinal, id);

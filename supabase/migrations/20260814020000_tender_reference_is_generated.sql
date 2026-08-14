-- `tenders.reference` is generated, and `updated_at` starts telling the truth.
--
-- The v1 schema declared `reference` as a human-facing identifier unique per org and
-- left it to whoever inserts the row. That is the wrong place for it: a reference typed
-- into a form is a reference two people can type the same, and the unique index would
-- surface the collision as a save that failed for reasons the Owner cannot act on.
-- Assumption A1 says it comes from a sequence, so the database is what hands it out.

-- `on delete cascade` where every other `org_id` in this schema is left restricting: a
-- counter is bookkeeping about an org rather than data belonging to it, and it is the
-- only thing in the database that would otherwise make an org undeletable.
create table tender_reference_counters (
  org_id      uuid    primary key references orgs(id) on delete cascade,
  last_issued integer not null default 1001
);

comment on table tender_reference_counters is
  'One row per org, holding the number most recently issued — the first Tender takes the default itself, and every one after it takes this plus one. A table rather than a Postgres sequence because the identifier is unique *per org*: a shared sequence would be unique too, but the second org would open at T-1043 rather than T-1001, which is exactly the sort of thing nobody notices until a client sees it.';

-- Not reachable from the browser at all. It carries no business data, every legitimate
-- write goes through the trigger below (which runs as the definer), and a member who
-- could bump this could burn a run of references for everyone.
alter table tender_reference_counters enable row level security;
revoke all on table tender_reference_counters from authenticated;

create function public.assign_tender_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  assigned integer;
begin
  -- `insert ... on conflict do update` is what makes this safe under concurrency: the
  -- second transaction blocks on the row lock rather than reading a number the first
  -- has taken but not yet committed. Gaps are fine — a rolled-back insert burns its
  -- number, and a reference is an identifier, not a count.
  insert into tender_reference_counters (org_id)
  values (new.org_id)
  on conflict (org_id) do update
    set last_issued = tender_reference_counters.last_issued + 1
  returning last_issued into assigned;

  new.reference := 'T-' || assigned;

  return new;
end
$$;

comment on function public.assign_tender_reference() is
  'Overwrites whatever the caller supplied rather than filling in a blank. `reference` is generated, so a client-supplied value is not a hint to be honoured — honouring it is how two Tenders end up fighting over T-1042.';

revoke all on function public.assign_tender_reference() from public;

create trigger tenders_assign_reference
  before insert on tenders
  for each row execute function public.assign_tender_reference();

-- Start each org's counter above anything already wearing a `T-<number>` reference.
--
-- Without this the first issued reference is T-1001 whatever is already in the table, and
-- a single pre-existing row holding that value turns the very first Tender an Owner
-- records into `tenders_org_reference_key` — the unactionable failed save this migration
-- exists to prevent. Nothing has recorded a Tender yet, so today this selects nothing;
-- it is here because "today" is not when the migration will be run against a database
-- that matters.
insert into tender_reference_counters (org_id, last_issued)
select org_id, max((substring(reference from '^T-(\d+)$'))::integer)
from tenders
where reference ~ '^T-\d+$'
group by org_id
on conflict (org_id) do update
  set last_issued = greatest(
    tender_reference_counters.last_issued,
    excluded.last_issued
  );

-- Editing a Tender is a v1 feature, and `reference` is not one of the things an edit may
-- reach. Pinning it here rather than trusting every writer to omit the column keeps the
-- guarantee in one place: whatever an update sends, the row keeps the reference it was
-- issued. Silent rather than an error, because the only way to hit it is to send a
-- column you had no business sending.
--
-- Why a trigger and not a column grant. The membership migration argues that GRANT is
-- the right layer for "which columns", and it is — where the column list is stable.
-- Postgres cannot revoke UPDATE on one column while UPDATE is held on the table, so this
-- would have to be `revoke update on tenders` followed by an explicit grant of the other
-- ten columns. Every later ticket that adds a column would then have to remember to add
-- it to that list, and forgetting is silent: the app simply stops being able to write the
-- new field. The guarantee here is about one column forever, so it lives with the trigger
-- that issues it.
create function public.pin_tender_reference()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.reference := old.reference;
  return new;
end
$$;

create trigger tenders_pin_reference
  before update on tenders
  for each row execute function public.pin_tender_reference();

-- `updated_at` shipped with a default and nothing to maintain it, which makes it a
-- column that reads as "last edited" and means "created". Editing a Tender and its Items
-- is this ticket's work, so the trigger arrives with it.
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger tenders_touch_updated_at
  before update on tenders
  for each row execute function public.touch_updated_at();

create trigger tender_items_touch_updated_at
  before update on tender_items
  for each row execute function public.touch_updated_at();

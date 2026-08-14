-- The v1 schema, in one migration.
--
-- This is the project's one deliberate horizontal slice. Several of these tables are
-- mutually dependent — `tender_items.selected_quote_id` points at `quotes`, which
-- points back at `tender_items` — and every later ticket builds on all of it. Make the
-- change easy, then make the easy change.
--
-- Conventions that run through the whole file:
--   * Primary keys are `uuid` defaulting to `gen_random_uuid()`.
--   * Enumerated values are `text` with a CHECK, never a Postgres ENUM. Every one of
--     these vocabularies has already moved once, and a CHECK is cheap to move again.
--   * Deadlines are `date` (a day in the org timezone); events are `timestamptz`.
--   * `org_id` sits on every table as a placeholder column, populated with one value
--     and never queried by. It is the entire concession to a future multi-tenant
--     product.
--   * MONEY IS PER UNIT unless the column name says otherwise. Every total is
--     `per_unit * tender_items.quantity`. Nothing in the schema enforces this and
--     every total gets rebuilt wrong without it.

create table orgs (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null,
  timezone        text        not null default 'Asia/Bangkok',
  fx_buffer_pct   numeric(5,4) not null default 0.0200,
  created_at      timestamptz not null default now()
);

comment on column orgs.timezone is
  'All date boundaries compute here, never server-local: Vercel runs UTC, which would roll the day seven hours early for every user. Org-level, not per-user — a deadline belongs to the Tender, not to whoever is looking at it.';
comment on column orgs.fx_buffer_pct is
  'fx_rate_applied = mid * (1 + fx_buffer_pct). A conservative buffer over ECB mid-market, erring toward overstating cost. A column, not a constant, so the real bank spread can replace it without a deploy.';

-- Profile row; `id` is the Supabase auth.users id.
create table users (
  id              uuid primary key references auth.users(id) on delete restrict,
  org_id          uuid        not null references orgs(id),
  name            text        not null,
  email           text        not null unique,
  wecom_userid    text        unique,                        -- hand-copied from the WeCom console
  is_org_admin    boolean     not null default false,
  locale          text        check (locale in ('en','zh-Hans')),  -- nullable: ask on first start-up
  disabled_at     timestamptz,                               -- soft disable; users are never deleted
  created_at      timestamptz not null default now()
);

-- There is deliberately no `role` enum and no `mobile` column.
--
-- `role`: under ten trusted users everyone is permitted to see everything, cost and
-- margin included, so a role column would encode a distinction the business does not
-- make.
--
-- `mobile`: WeCom mentions target `mentioned_list` (userid), not
-- `mentioned_mobile_list`. Both bind, but a mis-formatted mobile fails systematically
-- — the natural Thai local format binds for nobody, so one formatting mistake makes
-- the whole org silently unreachable at once. A typo'd userid drops exactly one
-- person, and the userid is readable from the console with no API call.
comment on column users.disabled_at is
  'Soft disable. A disabled user keeps their rows (a Quote records who sourced it) and reads nothing — RLS turns on this being null.';

create table suppliers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid        not null references orgs(id),
  name            text        not null,
  country         text,
  created_at      timestamptz not null default now()
);

-- Suppliers became a table so that one supplier cannot split across rows. The
-- constraint will reject legitimately distinct suppliers that share a name; that is
-- the accepted cost of the guarantee.
create unique index suppliers_org_name_key on suppliers (org_id, lower(name));

create table tenders (
  id                         uuid primary key default gen_random_uuid(),
  org_id                     uuid        not null references orgs(id),
  reference                  text        not null,   -- human-facing, e.g. 'T-1042'
  client_name                text        not null,
  title                      text        not null,
  date_received              date        not null,
  internal_quote_deadline    date        not null,
  client_submission_deadline date        not null,
  expected_decision_date     date,                   -- clients rarely state one
  submitted_at               timestamptz,            -- fact, not plan
  owner_user_id              uuid        not null references users(id),
  notes                      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create unique index tenders_org_reference_key on tenders (org_id, reference);

-- There is deliberately no `status` column, and no `outcome` column.
--
-- Progress (`new`/`sourcing`/`quoted`/`submitted`) is computed on every read from the
-- Quotes that exist. A hand-maintained status drifts inside a month and then every
-- metric lies quietly; derived state has no transitions to police, and regression is
-- automatic and correct — delete the last Quote on an Item and the Tender is
-- `sourcing` again.
--
-- Outcome lives on `tender_items`, because clients award part of a tender to us and
-- part to a competitor. The Tender-level outcome is derived and includes a `partial`
-- value that exists only as a display state and can never be stored.
comment on column tenders.submitted_at is
  'Null after client_submission_deadline means the Bid was never submitted. No column implies Submission Missed; it is the absence of this one, so it must be excluded explicitly wherever "active" is computed.';

create table tender_assignees (
  tender_id   uuid not null references tenders(id) on delete cascade,
  user_id     uuid not null references users(id),
  org_id      uuid not null references orgs(id),
  created_at  timestamptz not null default now(),
  primary key (tender_id, user_id)
);

comment on table tender_assignees is
  'Assignees compete rather than divide: every Assignee may source every Item, and two of them ringing the same supplier is expected.';

create table tender_items (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid          not null references orgs(id),
  tender_id                 uuid          not null references tenders(id) on delete cascade,
  product_name              text          not null,
  description               text,
  quantity                  numeric(14,3) not null check (quantity > 0),
  unit                      text          not null,   -- e.g. 'piece', 'box of 50'
  selected_quote_id         uuid,                     -- FK added below, once `quotes` exists
  landed_cost_per_unit      numeric(14,4) check (landed_cost_per_unit >= 0),      -- THB
  landed_cost_confirmed_at  timestamptz,              -- null => Unconfirmed => margin renders provisional
  selling_price_per_unit    numeric(14,4) check (selling_price_per_unit >= 0),    -- THB
  outcome                   text check (outcome in ('won','lost','no_bid','cancelled')),
  outcome_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint outcome_dated check ((outcome is null) = (outcome_at is null))
);

-- Margin is never stored: it is (selling_price_per_unit - landed_cost_per_unit), and a
-- stored copy would be a third number to keep in step with two that already move.
comment on column tender_items.landed_cost_confirmed_at is
  'Set when a human confirms the landed cost. Until then margin renders provisional, not as a number: a pre-filled cost has had no shipping, duty or handling added. Inferring "untouched" by comparing against the frozen Quote price breaks the moment shipping is genuinely zero.';

create table quotes (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid          not null references orgs(id),
  tender_item_id            uuid          not null references tender_items(id) on delete cascade,
  supplier_id               uuid          not null references suppliers(id),
  created_by_user_id        uuid          not null references users(id),  -- "sourced by"
  unit_price                numeric(14,4) not null check (unit_price > 0),  -- in `currency`, per `quoted_unit`
  currency                  text          not null,  -- ISO 4217
  quoted_unit               text          not null,  -- mismatch with the Item's unit => refuse to rank
  fx_rate_mid               numeric(18,8) not null check (fx_rate_mid > 0),      -- frozen at entry
  fx_rate_applied           numeric(18,8) not null check (fx_rate_applied > 0),  -- mid * (1 + fx_buffer_pct)
  fx_rate_as_of             date          not null,
  fx_rate_is_stale          boolean       not null default false,
  unit_price_thb            numeric(18,6) generated always as (unit_price * fx_rate_applied) stored,
  lead_time_days            integer,
  match_type                text          not null check (match_type in ('exact','alternative')),
  alternative_product_name  text,
  detail_notes              text,
  quoted_at                 date          not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint alternative_named check (
    match_type = 'exact' or alternative_product_name is not null
  )
);

-- THERE IS DELIBERATELY NO UNIQUE INDEX ON (tender_item_id, supplier_id).
--
-- Two Assignees ringing the same supplier and getting different prices is expected and
-- informative: it reveals that the negotiating position varies by who calls. The index
-- would delete the most interesting signal in the dataset and stop the second caller
-- recording their work at all. The comparison view surfaces the duplication with an
-- explicit banner naming both Assignees and both prices, rather than hiding it.
-- Why the price floors differ. `unit_price` mirrors the spec's own `quantity > 0`: a
-- Quote *is* a price, and the absence of one is recorded as No Supplier Found, never as
-- zero. The two THB figures on `tender_items` stop at rejecting negatives, because zero
-- is commercially meaningful there — a line bid as a freebie to win the whole Tender,
-- or a cost fully absorbed. Negatives are wrong on all three: a typo'd `-125` ranks
-- first in a view that sorts by cheapest THB and wins every comparison it appears in,
-- and the same typo on landed cost inflates the margin the dashboard reports.
comment on column quotes.created_by_user_id is
  '"Sourced by", and load-bearing: with the same supplier legitimately quoted twice, it is the only thing distinguishing two otherwise identical rows.';
comment on column quotes.fx_rate_mid is
  'ECB mid-market, frozen at entry. Both rates are stored so the buffer stays visible and cannot be silently applied twice, and so a displayed ranking is always reproducible from the stored data.';

-- The Selected Quote, and why the FK is composite rather than the obvious
-- `references quotes(id)`.
--
-- A8 chose `tender_items.selected_quote_id` over a `quotes.is_selected` boolean to make
-- "one Selected Quote per Item" structural rather than a rule the app has to remember.
-- A plain FK only gets half of that: it does stop two Quotes being selected, but it
-- happily lets an Item point at a Quote belonging to a *different* Item. From then on
-- the Item's Selected price, its THB conversion and every total derived from
-- `per_unit * quantity` come from an unrelated Item, and nothing in the database or the
-- app is in a position to notice.
--
-- Pairing the referencing Item's own id into the key closes it: the target row must be
-- a Quote whose `tender_item_id` is this Item. The unique constraint is redundant with
-- the primary key on `id` alone and is required anyway, because a foreign key can only
-- reference a unique constraint.
alter table quotes
  add constraint quotes_id_tender_item_key unique (id, tender_item_id);

-- The column list on SET NULL is load-bearing, not decoration. The referencing columns
-- include `tender_items.id` — the primary key — and an unqualified `on delete set null`
-- would try to null that too, which fails the delete outright rather than clearing the
-- selection. Naming the column confines it to the one that may be nulled. (Postgres 15+.)
alter table tender_items
  add constraint tender_items_selected_quote_fk
  foreign key (selected_quote_id, id) references quotes(id, tender_item_id)
  on delete set null (selected_quote_id);

create table quote_photos (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id),
  quote_id            uuid not null references quotes(id) on delete cascade,
  storage_path        text not null,
  uploaded_by_user_id uuid not null references users(id),
  uploaded_at         timestamptz not null default now()
);

comment on table quote_photos is
  'What the supplier says they can actually provide. Load-bearing rather than decorative: on an Alternative it is often the only way to judge how far the substitute is from what was asked for.';

-- Client-supplied images. `tender_item_id` is nullable because they arrive per-Tender
-- — one email, five photos — and are assigned to an Item afterwards.
create table reference_images (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id),
  tender_id           uuid not null references tenders(id) on delete cascade,
  tender_item_id      uuid references tender_items(id) on delete set null,
  storage_path        text not null,
  uploaded_by_user_id uuid not null references users(id),
  uploaded_at         timestamptz not null default now()
);

-- An Assignee's explicit "I could not source this". Distinguishes "nobody could supply
-- this" from "nobody tried", which mean opposite things when deciding whether to Bid.
create table no_supplier_found (
  tender_item_id  uuid not null references tender_items(id) on delete cascade,
  user_id         uuid not null references users(id),
  org_id          uuid not null references orgs(id),
  note            text,
  created_at      timestamptz not null default now(),
  primary key (tender_item_id, user_id)
);

-- Frankfurter's daily fetch lands here. ECB reference rates: mid-market, business days
-- only, so a quote entered on a Saturday uses Friday's rate.
create table fx_rates (
  currency    text          not null,   -- foreign currency, ISO 4217
  as_of       date          not null,   -- ECB reference date
  rate_to_thb numeric(18,8) not null check (rate_to_thb > 0),
  fetched_at  timestamptz   not null default now(),
  primary key (currency, as_of)
);

create table reminders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id),
  tender_id     uuid not null references tenders(id) on delete cascade,
  milestone     text not null check (milestone in ('internal_quote','client_submission','decision_chase')),
  days_before   integer,
  remind_on     date,
  due_date      date not null,              -- computed and stored; queried with <=, never =
  sent          boolean not null default false,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint anchor_exactly_one check ((days_before is null) <> (remind_on is null))
);

-- The cron's whole working set: everything still owed, however far back. Partial,
-- because sent reminders are the overwhelming majority and are never queried this way.
create index reminders_due on reminders (due_date) where not sent;

comment on column reminders.due_date is
  'Computed and stored, then queried with <= so a missed cron run catches up rather than skipping a day silently. Stored derived state, and the one place this schema has any: it does NOT recompute when the tender deadline it was derived from moves, so whatever edits a deadline must recompute the unsent reminders on that tender. A deadline moved later leaves a due_date in the past, which the <= query fires immediately rather than not at all.';

-- Ships in v1 even though the in-app bell does not: reminders need it for dedupe and
-- catch-up, and the bell later becomes a read model over these rows.
create table notifications (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id),
  user_id         uuid not null references users(id),
  type            text not null,
  tender_id       uuid references tenders(id) on delete cascade,
  tender_item_id  uuid references tender_items(id) on delete cascade,
  body            text not null,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------
-- Row-level security
--
-- RLS is here because Supabase's anon key reaches the browser, and an unprotected
-- table in `public` is readable through PostgREST by anyone who opens devtools. It is
-- NOT a permission model: there is deliberately no column-level restriction on cost,
-- selling price or margin, because under ten trusted users everyone is permitted to
-- see everything.
-- ---------------------------------------------------------------------------------

-- SECURITY DEFINER so that reading `users` inside a policy on `users` does not recurse
-- into that same policy. Owned by the migration role, which is the table owner and so
-- is not itself subject to RLS. `search_path` is pinned because a SECURITY DEFINER
-- function that resolves names through the caller's path is a privilege-escalation
-- hole.
create function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select org_id
  from public.users
  where id = auth.uid()
    and disabled_at is null
$$;

comment on function public.current_org_id() is
  'The caller''s org, or null if they are signed out, have no profile row, or are disabled. Every policy in this schema turns on it: `org_id = null` is null, never true, so a disabled user matches no row anywhere.';

revoke all on function public.current_org_id() from public;
grant execute on function public.current_org_id() to authenticated, service_role;

-- One policy, one shape, on every table carrying `org_id`. Generated in a loop rather
-- than written out eleven times so the shape cannot drift on a single table and go
-- unnoticed — which is exactly the failure this is protecting against.
do $$
declare
  target text;
begin
  foreach target in array array[
    'users', 'suppliers', 'tenders', 'tender_assignees', 'tender_items', 'quotes',
    'quote_photos', 'reference_images', 'no_supplier_found', 'reminders',
    'notifications'
  ]
  loop
    execute format('alter table public.%I enable row level security', target);
    execute format(
      'create policy org_members_full_access on public.%I
         for all to authenticated
         using (org_id = public.current_org_id())
         with check (org_id = public.current_org_id())',
      target
    );
  end loop;
end
$$;

-- `orgs` is the org, so it matches on its own primary key rather than on `org_id`.
alter table orgs enable row level security;
create policy org_members_full_access on orgs
  for all to authenticated
  using (id = public.current_org_id())
  with check (id = public.current_org_id());

-- `fx_rates` is reference data with no owner — ECB rates are the same for everyone, and
-- the daily fetch writes one shared set. Two things follow. The org half of the policy
-- has nothing to match on, so only the not-disabled half survives; and the policy is
-- read-only, because the only legitimate writer is the Frankfurter fetch, which runs
-- with the service role and bypasses RLS anyway. A writable policy here would hand the
-- browser's anon key an edit on the rate every future quote freezes at entry.
alter table fx_rates enable row level security;
create policy org_members_read on fx_rates
  for select to authenticated
  using (public.current_org_id() is not null);

-- ---------------------------------------------------------------------------------
-- Seed
--
-- The one org. `org_id` is a placeholder column populated with a single value, so this
-- row has to exist before any other row in the database can.
-- ---------------------------------------------------------------------------------

insert into orgs (name) values ('Taihue');

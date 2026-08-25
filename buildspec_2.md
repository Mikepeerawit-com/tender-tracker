# Tender Tracker — buildspec_2

**Status:** ready to build. Supersedes `tender-tracker-buildspec_1.md` entirely.

This document is **standalone**. A build session needs nothing but this file, `CONTEXT.md` (the glossary) and the repo. Where a decision was expensive to reach, the reasoning is restated here rather than linked, because the reasoning is what stops the decision being accidentally reversed. Links to ADRs and tickets are **provenance, not required reading**.

Every claim below either traces to a resolved decision or appears in [Assumptions](#assumptions) marked as an assumption. There are no unmarked guesses.

---

## Problem Statement

Taihue is a Thailand-registered medical-supplies trading company. Clients send them tenders — requests to price a list of products. For each product, several colleagues phone round their own suppliers, collect prices in several currencies, and the team picks what to bid back. The whole process currently lives in chat threads, spreadsheets and memory.

Three things go wrong, in increasing order of cost:

1. **Nobody can see what is going on right now.** There is no single place that says which tenders are live and what the next thing that has to happen is.
2. **Comparing supplier prices is manual and error-prone.** Prices arrive in THB, CNY and USD, sometimes for a different product than the one asked for, sometimes in a different unit — "box of 50" against "piece" — and the comparison happens by eye.
3. **Deadlines get missed.** Occasionally a bid does not reach the client in time. The tender is then dead: there is no partial credit and no recovery. **This is the failure the product exists to prevent.**

## Solution

A web app — desktop and phone, English and Simplified Chinese — that holds tenders, the supplier quotes gathered against them, and what was bid back; that ranks competing quotes in one currency without pretending the conversion is authoritative; and that pushes deadline reminders into the WeCom group the team already lives in.

Three shaping ideas run through the whole design:

- **Nothing that can be derived is stored.** There is no status column. Progress, "overdue", win rates and totals are computed on read, because a hand-maintained status drifts from reality inside a month and then every number on the dashboard lies quietly.
- **Being loudly unhelpful beats being quietly wrong.** Where the app cannot honestly rank quotes — mismatched units, a lead smaller than the currency drift, a cost figure nobody has confirmed — it says so and refuses, rather than showing a confident wrong answer.
- **The end-to-end path starts on a phone.** A reminder fires into WeCom, someone taps it, and the page opens inside WeCom's in-app webview — **from which there is no way out to Safari**. Everything a reminder can reach must work there.

---

## User Stories

**Tenders and items**

1. As an Owner, I want to record a tender with the client's name, the date it arrived and its deadlines, so that the enquiry stops living in my inbox.
2. As an Owner, I want to add several Tender Items to one Tender, so that a five-product RFQ is one opportunity rather than five.
3. As an Owner, I want to enter a quantity and a unit on each Tender Item, so that a per-unit price can be turned into what the line is actually worth.
4. As an Owner, I want to set an Internal Quote Deadline separately from the Client Submission Deadline, so that the team is chased to source before the deadline that actually kills the tender.
5. As an Owner, I want to attach the sample images the client sent with their RFQ as Reference Images, so that the picture of what was asked for sits next to the pictures of what suppliers offered.
6. As an Owner, I want to drop five client photos in at once and assign them to Items afterwards, so that the upload matches how they actually arrive — one email, several pictures.
7. As an Owner, I want to record that our Bid went out, so that the app can tell "submitted on time" from "never submitted".
8. As an Owner, I want to add and remove Assignees on my Tender, so that the right colleagues get its reminders.
9. As any user, I want to add myself to a Tender, so that I can start sourcing it without waiting to be asked.

**Sourcing**

10. As an Assignee, I want to enter a supplier's price for one Tender Item, so that it can be compared against everyone else's.
11. As an Assignee, I want to record the price in the currency the supplier quoted, so that I am not doing conversion arithmetic on a phone call.
12. As an Assignee, I want to record the unit the supplier quoted in, so that a price per box is never silently compared against a price per piece.
13. As an Assignee, I want to mark a quote as an Alternative and name the substitute product, so that the comparison shows "Requested: X / Quoted: Y" instead of burying it in notes.
14. As an Assignee, I want to attach Quote Photos to a quote, so that a reviewer can judge how far an Alternative really is from what was asked for.
15. As an Assignee on a phone, I want the photo control to open the camera directly, so that the gesture is "take one now" rather than "find a file".
16. As an Assignee, I want to record No Supplier Found on an Item, so that "nobody could supply this" is distinguishable from "nobody tried" — and so the app stops chasing me for work that cannot be done.
17. As an Assignee, I want to quote the same supplier a colleague already quoted, so that a different price from the same factory is captured rather than blocked.
18. As an Assignee, I want my name against every quote I entered, so that when two rows show the same supplier it is clear who got which price.

**Deciding and bidding**

19. As a user, I want one page per Tender showing every Item and where each has got to, so that I can see the whole opportunity without navigating.
20. As a user, I want Items that still need a quote selected to be open by default and decided ones folded away, so that the page opens showing exactly the work that is left.
21. As a user, I want competing quotes ranked cheapest-first in THB, so that I can scan a column of numbers instead of comparing by eye.
22. As a user, I want the supplier's original amount and currency shown as the primary number with THB beneath it, so that I never mistake a converted figure for what the supplier actually said.
23. As a user, I want to see the rate and its date behind each conversion, so that I can tell how old the arithmetic is.
24. As a user, I want the app to refuse to rank an Item where a quote is in a different unit, so that I am not confidently shown the wrong cheapest supplier.
25. As a user, I want a warning when the top two quotes are closer together than the currency drift between them, so that I do not treat a 1.3% lead as real.
26. As a user, I want a warning when every quote on an Item is an Alternative, so that I know the ranking is comparing different products.
27. As a user, I want to select the winning quote in one click with no confirmation step, so that deciding is not a workflow.
28. As a user, I want Landed Cost pre-filled from the quote I selected and then editable, so that shipping, duty and handling can be added to a supplier price that excludes them.
29. As a user, I want margin to compute live as I type the selling price, so that I can find the price I want to bid rather than calculating it elsewhere.
30. As a user, I want a margin derived from an unconfirmed Landed Cost shown as provisional rather than as a number, so that I never read an understated cost as a real one.
31. As a user, I want photo counts that open a lightbox rather than thumbnail strips, so that photos do not eat the horizontal room the numbers need.
32. As a user, I want to record an Outcome per Tender Item, so that a client awarding half the tender to a competitor can be recorded truthfully.

**Seeing what to do next**

33. As a user, I want the tender list grouped by what is wrong with each Tender — missed, overdue, coming up — so that opening the app at 9am tells me what to do rather than how we are doing.
34. As a user, I want each Tender to appear in exactly one group, so that the list is a worklist and not a report.
35. As a user, I want submitted-but-undecided Tenders held separately, so that the normal resting state of a live tender does not read as a problem.
36. As a user, I want written-off and cancelled Tenders out of the default list, so that the list is work I still have to do.

**Being told**

37. As an Assignee, I want to be @mentioned in the WeCom group when the Internal Quote Deadline approaches **and I have not entered any quotes**, so that the robot does not train everyone to mute it by nagging people who already did the work.
38. As an Owner, I want to be @mentioned as the Client Submission Deadline approaches, on an escalating schedule, so that the deadline that kills tenders gets louder.
39. As an Owner, I want one group post when a submission is actually missed, so that it is not discovered a week later.
40. As an Owner, I want to set a decision-chase reminder on an absolute date, so that I remember to chase a client who never stated when they would decide.
41. As an Assignee who quoted an Item, I want to be told when that Item is won or lost — even if my quote was not the one selected — so that I learn how my supplier compared.
42. As a team member, I want a once-daily digest of every open Tender and its next milestone in the group, so that "what is going on right now" is answered without opening the app.
43. As a team member, I want group messages to carry no prices, no margins and no supplier names, so that commercially sensitive detail stays in the app.
44. As a team member, I want reminders that were missed by an outage to arrive late rather than never, so that one bad deploy day does not silently drop a deadline.
45. As an Owner, I want reminders to re-arm when I push a deadline back, so that a Tender does not go quiet exactly when it has the most runway left.
46. As an Org Admin, I want to send a test @mention to one user, so that I can confirm their WeCom identifier actually reaches them — the API reports success either way.

**Getting in**

47. As an invited colleague, I want to set a password from an emailed invite, so that I have an account.
48. As an Org Admin, I want to be the only person who can invite, so that accounts do not appear by themselves.
49. As a user, I want to stay logged in for a month, so that a tool I open a few times a week does not ask for a password every time.
50. As a user tapping a reminder inside WeCom, I want the app to open and work in place, so that I am never told to "open this in your browser" — there is no way to do that.
51. As a Chinese-reading colleague, I want every screen in Simplified Chinese, so that the app is usable rather than tolerable.
52. As a user, I want to pick my language on first start-up and change it later, so that the app does not guess wrong and leave me with raw translation keys.
53. As an Org Admin, I want a departing colleague disabled rather than deleted, so that the Tenders they own and the quotes they entered stay readable.

---

## Implementation Decisions

### Stack

Carried forward from `buildspec_1` unchanged — these were never in question:

- **Next.js (App Router), deployed on Vercel.**
- **Supabase** — Postgres, Auth, Storage.
- **Tailwind CSS + shadcn/ui.**
- **next-intl**, with key lookups from day one and no hardcoded strings in components.

Two additions the de-risking forced:

- **`@supabase/ssr`** for session handling — see [Sessions](#sessions-must-live-in-cookies-not-localstorage). This is not optional.
- **Vercel Cron**, one daily job.

v1 has exactly **two pieces of infrastructure** (Vercel, Supabase) and exactly **one outbound integration** (the WeCom group-robot webhook). No inbound endpoint, no IP whitelist, no OAuth shim, no third deployment target.

### Hosting, and the reasoning a future reader must not reverse

**Vercel + Supabase, Supabase in the Singapore region (`ap-southeast-1`), app on a custom domain.** Roughly $12/year, plus Supabase Free moving to Pro.

The reasoning matters because it is easy to overturn by accident:

- **Mainland-China reachability is an explicit non-goal.** Staff are mainly in Thailand; the few who occasionally work from China use their own VPN. The app is **not** engineered for the GFW. Do not add a Supabase Custom Domain add-on, do not reach for a mainland CDN, do not re-derive this analysis — it was done, and this is its answer.
- **An ICP filing is impossible for this company and this is a fixed constraint, not an oversight.** WeCom's **Trusted domain name** field demands a domain whose ICP filing entity matches the company entity; an ICP filing requires a mainland-registered entity *and* mainland-hosted servers. A Thailand-registered company cannot obtain one without becoming a different company. This blocks WeCom's Web Authorization and JS-SDK — **and nothing else**. It does not block the group robot, and it does not block links opening in the WeCom webview.
- **Supabase Free to start; upgrade to Pro before the first real (non-test) Tender is entered.** That named trigger is deliberate — "when needed" never happens, Free has no automated backups, and there is no legacy system to fall back on. Verify current plan terms at build time.

**Storage:** direct browser-to-Storage uploads using **`createSignedUploadUrl()`**. Do **not** hand-roll an S3-presigned `PUT` — the compress-and-upload path was measured working through the signed-URL route inside the WeCom webview, and a hand-rolled equivalent was not. Images are compressed client-side before upload. Signed URLs for reads. **No generated derivatives** and no retention rule.

### Sessions must live in cookies, not localStorage

Sessions last **30 days with no idle timeout** — an internal tool, under ten trusted users, largely on personal phones, all of whom may already see margin.

**That 30 days is 7 days unless the session is carried in a server-set cookie.** WebKit's Tracking Prevention deletes all script-writable storage — `localStorage` is named in the capped set — after **7 days without user interaction with the site**, and scrolling does not count. `supabase-js` stores its session in `localStorage` by default, and this app's usage is reminder-driven and therefore sparse by design: someone taps a link when a deadline nears, which is precisely the pattern that lives outside a 7-day window.

**So: `@supabase/ssr`, server-set cookies, never `localStorage`.** This is not a WeCom problem — Mobile Safari, one of the two browsers this app promises, applies the identical rule. The webview is where it surfaced, not where it lives.

### Auth

**Email/password only, and it is permanent.** It is the floor, not a stopgap: every user can always log in with it whatever state WeCom or its console is in. "Nobody can log in" is not a recoverable position for the tool the business runs tenders on.

- **Accounts exist only by invitation.** The Org Admin invites by email; the invitee sets a password. There is no self-signup and no other route into the app.
- **Invites are sent through Resend**, configured as custom SMTP in Supabase. Supabase's built-in mailer is rate-limited and not for production. The invite is the **only** email the app sends.
- **Onboarding still starts inside WeCom**: the group robot posts the invite link into the WeCom group, so the first tap happens where the team already is.
- **No password-reset flow.** Under ten users, the Org Admin resets a password in the Supabase dashboard. This keeps the email surface at exactly one template.
- **`is_org_admin` is a boolean, true for exactly one row** — not a role enum. Inviting is the only thing it gates. It confers no extra visibility.
- **Users are soft-disabled, never deleted.** A departing user owns Tenders and entered Quotes that the comparison view is built on. Offboarding is a manual runbook step; nothing checks WeCom membership automatically.
- **`wecom_userid` is populated by hand, and is not a login credential.** An Org Admin copies it from the WeCom console (**Contacts → member → Account**) once per user. It exists solely so reminders can @mention that person.

**WeCom QR login is deferred to v1.1** — measured, viable, and deliberately not built. See [Deferred](#deferred-to-v11-with-reasons). Do not implement it, and do not re-investigate it.

### Data model

Postgres, via Supabase migrations. Conventions used throughout:

- Primary keys are `uuid` defaulting to `gen_random_uuid()`.
- Enumerated values are **`text` with a `CHECK` constraint**, not Postgres `ENUM` types — they are cheaper to evolve, and every one of them is a business vocabulary that has already moved once.
- Deadlines are `date` (a day in the org timezone); events are `timestamptz`.
- `org_id` is on every table as a **placeholder column**, populated with one value and never queried by. It is the entire concession to a future multi-tenant product.
- **Money is per unit** unless a column says otherwise. This grain was never stated anywhere in `buildspec_1` and every total gets rebuilt wrong without it: **every total is `per_unit × tender_items.quantity`.**

```sql
create table orgs (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null,
  timezone        text        not null default 'Asia/Bangkok',
  fx_buffer_pct   numeric(5,4) not null default 0.0200,
  created_at      timestamptz not null default now()
);

-- Profile row; id is the Supabase auth.users id.
create table users (
  id              uuid primary key references auth.users(id) on delete restrict,
  org_id          uuid        not null references orgs(id),
  name            text        not null,
  email           text        not null unique,
  wecom_userid    text        unique,               -- nullable; hand-copied from the WeCom console
  is_org_admin    boolean     not null default false,
  locale          text        check (locale in ('en','zh-Hans')),  -- nullable: ask on first start-up
  disabled_at     timestamptz,                       -- soft disable; users are never deleted
  created_at      timestamptz not null default now()
);
-- NOTE: no `role` enum, and no `mobile` column. Both were considered and removed.

create table suppliers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid        not null references orgs(id),
  name            text        not null,
  country         text,
  created_at      timestamptz not null default now()
);
create unique index suppliers_org_name_key on suppliers (org_id, lower(name));

create table tenders (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid        not null references orgs(id),
  reference                 text        not null,   -- human-facing, e.g. 'T-1042'; unique per org
  client_name               text        not null,
  title                     text        not null,
  date_received             date        not null,
  internal_quote_deadline   date        not null,
  client_submission_deadline date       not null,
  expected_decision_date    date,                   -- clients rarely state one
  submitted_at              timestamptz,            -- fact, not plan; null after the deadline == never submitted
  owner_user_id             uuid        not null references users(id),
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index tenders_org_reference_key on tenders (org_id, reference);
-- NOTE: there is deliberately no `status` column. See "Progress is derived" below.

create table tender_assignees (
  tender_id   uuid not null references tenders(id) on delete cascade,
  user_id     uuid not null references users(id),
  org_id      uuid not null references orgs(id),
  created_at  timestamptz not null default now(),
  primary key (tender_id, user_id)
);

create table tender_items (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid          not null references orgs(id),
  tender_id                 uuid          not null references tenders(id) on delete cascade,
  product_name              text          not null,
  description               text,
  quantity                  numeric(14,3) not null check (quantity > 0),
  unit                      text          not null,   -- e.g. 'piece', 'box of 50'
  selected_quote_id         uuid,                     -- FK added after `quotes` exists
  landed_cost_per_unit      numeric(14,4),            -- THB
  landed_cost_confirmed_at  timestamptz,              -- null => Unconfirmed => margin renders provisional
  selling_price_per_unit    numeric(14,4),            -- THB
  outcome                   text check (outcome in ('won','lost','no_bid','cancelled')),
  outcome_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint outcome_dated check ((outcome is null) = (outcome_at is null))
);
-- NOTE: margin is never stored. It is (selling_price_per_unit - landed_cost_per_unit).

create table quotes (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid          not null references orgs(id),
  tender_item_id            uuid          not null references tender_items(id) on delete cascade,
  supplier_id               uuid          not null references suppliers(id),
  created_by_user_id        uuid          not null references users(id),  -- "sourced by"; load-bearing
  unit_price                numeric(14,4) not null,  -- in `currency`, per `quoted_unit`
  currency                  text          not null,  -- ISO 4217
  quoted_unit               text          not null,  -- mismatch with the Item's unit => refuse to rank
  fx_rate_mid               numeric(18,8) not null,  -- frozen at entry
  fx_rate_applied           numeric(18,8) not null,  -- mid * (1 + fx_buffer_pct)
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

alter table tender_items
  add constraint tender_items_selected_quote_fk
  foreign key (selected_quote_id) references quotes(id) on delete set null;

-- THERE IS DELIBERATELY NO UNIQUE INDEX ON (tender_item_id, supplier_id). See below.

create table quote_photos (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id),
  quote_id            uuid not null references quotes(id) on delete cascade,
  storage_path        text not null,
  uploaded_by_user_id uuid not null references users(id),
  uploaded_at         timestamptz not null default now()
);

-- Client-supplied images. tender_item_id is nullable: they arrive per-Tender
-- (one email, five photos) and are assigned to an Item afterwards.
create table reference_images (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id),
  tender_id           uuid not null references tenders(id) on delete cascade,
  tender_item_id      uuid references tender_items(id) on delete set null,
  storage_path        text not null,
  uploaded_by_user_id uuid not null references users(id),
  uploaded_at         timestamptz not null default now()
);

-- An Assignee's explicit "I could not source this".
create table no_supplier_found (
  tender_item_id  uuid not null references tender_items(id) on delete cascade,
  user_id         uuid not null references users(id),
  org_id          uuid not null references orgs(id),
  note            text,
  created_at      timestamptz not null default now(),
  primary key (tender_item_id, user_id)
);

create table fx_rates (
  currency    text          not null,   -- foreign currency, ISO 4217
  as_of       date          not null,   -- ECB reference date (business days only)
  rate_to_thb numeric(18,8) not null,
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
create index reminders_due on reminders (due_date) where not sent;

-- Ships in v1 even though the in-app bell does not: reminders need it for
-- dedupe and catch-up, and the bell later becomes a read model over these rows.
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
```

**RLS:** enable row-level security on every table with a single policy — an authenticated user whose `users` row is not disabled has full read/write access to rows in their `org_id`. This is necessary because Supabase's anon key reaches the browser and unprotected `public` tables are readable through PostgREST. It is **not** a permission model: there is deliberately **no column-level restriction on cost, selling price or margin**, because under ten trusted users everyone is permitted to see everything, and the `role` enum was removed for the same reason.

### Four schema decisions a future reader will want to undo

Each of these looks like an oversight and is not.

1. **There is no `status` column.** `buildspec_1` had `tenders.status` as `new | sourcing | quoted | won | lost | cancelled`. It was split in two, and only half is stored — see the next section. A hand-maintained status drifts inside a month and then silently corrupts every metric.
2. **There is no unique constraint on `(tender_item_id, supplier_id)`.** Two Assignees ringing the same supplier and getting different prices is *expected and informative* — it reveals that the negotiating position varies by who calls. Adding the index would delete the most interesting signal in the dataset and stop the second caller recording their work at all. The comparison view surfaces the duplication with an explicit banner naming both Assignees and both prices, rather than hiding it.
3. **Outcome lives on `tender_items`, not `tenders`.** Clients award part of a tender to us and part to a competitor. A Tender's overall outcome is derived, and includes a `partial` value that exists **only as a display state and can never be stored**.
4. **`users.mobile` does not exist.** WeCom mentions target `mentioned_list` (userid), not `mentioned_mobile_list`. Both bind, but a mis-formatted mobile fails *systematically* — the natural Thai local format binds for nobody, so one formatting mistake makes the whole org silently unreachable at once — while a typo'd userid drops exactly one person. The userid is readable from the console with no API call.

### Progress is derived; Outcome is stored

**Progress** — computed on every read, never stored:

| Progress | Condition |
|---|---|
| `submitted` | `submitted_at` is not null |
| `quoted` | every Item whose Outcome is not `no_bid` has ≥1 Quote |
| `sourcing` | at least one Item has ≥1 Quote |
| `new` | otherwise |

Evaluated top-down. Items marked `no_bid` are excluded, or a single unsourceable Item pins a Tender at `sourcing` forever. Derived state has no transitions to police, and regression is automatic and correct: delete the last Quote on an Item and the Tender is `sourcing` again.

**Tender-level Outcome** — derived in this order:

1. Any Item with a null Outcome → the Tender has no Outcome; it is still open.
2. Otherwise consider only Items whose Outcome is `won` or `lost`. If that set is empty → `no_bid` if any Item is `no_bid`, else `cancelled`.
3. Otherwise: all `won` → **won**; all `lost` → **lost**; mixed → **partial**.

Win rate is `won / (won + lost)`; `no_bid` and `cancelled` are excluded from the denominator.

### "Overdue" is three unrelated conditions

Collapsing these into one badge makes the app unable to say which one you have. All date boundaries compute **server-side in the org timezone**.

- **Sourcing Overdue** — `internal_quote_deadline < today`, not submitted, no Item has an Outcome, and **at least one Item is Not Yet Sourced**. *Not Yet Sourced* means an Item with neither a Quote nor a No Supplier Found record — the third sourcing state. Counting "Items with no Quote" instead nags an Assignee who already answered. Ours, fixable, concerns an Assignee.
- **Submission Missed** — `submitted_at is null`, `client_submission_deadline < today`, no Item has an Outcome. Fatal, concerns the Owner. No column implies this; it is the *absence* of one, so it must be excluded explicitly wherever "active" is computed.
- **Awaiting Decision** — submitted, Outcomes unrecorded. **Not a failure** — the normal resting state of a live tender, and a prompt to chase the client. `buildspec_1` had no name for the state the business spends most of its time in.

**Two definitions of Sourcing Overdue coexist, deliberately.** The one above decides *which block a Tender appears in* (Item-level). Reminder targeting uses a different, per-Assignee rule: mention only Assignees who have entered **no quotes at all** on that Tender. They answer different questions and must not be merged.

### Currency

- **Reporting Currency is THB**, for both the comparison view and the dashboard. Quotes are always stored in the supplier's original currency; conversion is display-only.
- **Rates from [Frankfurter](https://frankfurter.dev/)** — MIT, no API key, no quota, explicitly free for commercial use, self-hostable if it disappears. Fetched daily by the same cron that sends reminders, into `fx_rates`. Alternatives were rejected on licence: Open Exchange Rates restricts its free tier to personal/small-scale/open-source use; exchangerate.host is an APILayer commercial product with unclear free terms.
- **Caveat to carry:** Frankfurter serves **ECB reference rates — mid-market, business days only**. A quote entered on a Saturday uses Friday's rate.
- **On fetch failure, use the last known rate and set `fx_rate_is_stale`. Never block quote entry.**
- **Frozen at entry.** The Quote stores `fx_rate_mid`, `fx_rate_applied` and `fx_rate_as_of`. History stays stable and auditable, dashboard totals do not drift, and nothing depends on a rate service at render time.
- **A conservative buffer, not decimal rounding.** ECB mid-market is not what a bank charges, so `fx_rate_applied = mid × (1 + fx_buffer_pct)`, default **2%**, erring toward *overstating* cost. Decimal rounding was rejected as a ~0.1% buffer that protects against nothing. Both rates are stored, so the buffer stays visible and cannot be silently applied twice.
- **THB-quoted rows are not converted.** `fx_rate_mid` and `fx_rate_applied` are 1, and the view shows "฿ — quoted in THB" rather than repeating the number, so there is no fake conversion.

### Screens

Five screens. **Functional parity between phone and desktop is a requirement**: nothing a user can do at a desk may be unavailable on a phone. Layout may differ; capability may not.

**1 — Login.** Email/password. It must work inside the WeCom in-app webview, because that is where reminder links land and **there is no way out of it into Safari**. "Open this in your browser" must never appear as advice anywhere in the app. Measured on iOS: the page opens clean, with no security banner above the form.

**2 — Tender list.** The app's home. Rendered as blocks, evaluated top-down so **every Tender appears in exactly one**:

1. **Submission Missed** — red, loud, and it stays on the list rather than dropping out; it leaves only when an Outcome is recorded.
2. **Sourcing Overdue.**
3. **Coming up** — either deadline falling in a **rolling 7 days**, each row labelled with *which* deadline it is.
4. **Awaiting Decision** — submitted, undecided.
5. **Everything else** under the default filter: not submitted, not written off (`no_bid`/`cancelled`), not already Submission Missed.

Rolling 7 days, not a calendar week: a calendar week collapses to near-nothing by Friday. And it must be *either* deadline — under Client Submission alone, a Tender reads "due 19 Aug" and looks healthy while its Internal Quote Deadline passed two days ago with an Item unsourced, which is the one actionable thing on the screen.

There are **no metric cards in v1**. `buildspec_1`'s four were labels, not definitions, and three were wrong in ways invisible from the card. "Active tenders" had four defensible readings giving 8/8/5/7 on ten Tenders and survives only as the default filter above; "total quoted value" is deleted outright (see [Deferred](#deferred-to-v11-with-reasons)).

**3 — Add / edit tender.** Client, title, reference, the three dates, Owner, Assignees, and Tender Items each with product name, quantity and unit. Reference Images upload here, per-Tender, and are assigned to Items afterwards.

**4 — Add quote.** Per Tender Item: supplier, unit price, currency, quoted unit, lead time, match-type toggle (`exact`/`alternative`, revealing the substitute name field), detail notes, and Quote Photos. The photo input carries **`accept="image/*" capture`** — on a phone the gesture is *take one now*. **`capture` is a hint, not a guarantee**: a visible file-picker fallback is required (see [Assumptions](#assumptions)).

**5 — Tender detail / comparison working sheet.** The densest screen in v1 and the one the prototypes settled in most detail. Prototype: [`prototypes/09-comparison-view/index.html`](https://github.com/Mikepeerawit-com/tender-tracker/blob/prototype/comparison-view/prototypes/09-comparison-view/index.html) on branch `prototype/comparison-view` (variant **D** is the default and is the one that ships; A/B/C are preserved for context). Phone reflow: [`prototypes/16-comparison-view-mobile/index.html`](https://github.com/Mikepeerawit-com/tender-tracker/blob/main/prototypes/16-comparison-view-mobile/index.html).

- **One row per Tender Item**, whole Tender on one page, holding: Item · Selected Quote · Landed cost/unit · Selling/unit · Margin/unit · Margin on line. A totals bar underneath: coverage, Bid total, landed cost, margin. The row is a wrapping line rather than a fixed-column table, and the Margins sit under the two price fields at every width — see ADR-0009's amendment for why a table could not also clear the no-overflow bar at 390px.
- **Openness is derived, not remembered.** An Item with no Selected Quote opens expanded; a decided Item folds away. A twisty overrides per Item for that visit only. The header reads e.g. "2 of 4 Items still need a Quote selected", so the page opens showing exactly the work left.
- **Expanded, an Item shows a dense table**, cheapest-first in THB: rank · supplier · sourced by · quoted product · unit price (+ derived THB, + `lowest` chip) · line total · photos · Select. **One click to select, no confirm step.**
- **Cards were tested and lost decisively at desktop width**, collapsing at ~4 of the 8 competing quotes that compete-not-divide makes normal.
- **Original amount primary and bold; THB beneath it in grey with `≈`**; rate and `as_of` on hover. The `lowest` chip is used, never the word "cheapest" — the lowest is highlighted, not stamped.
- **"Sourced by" is a column and is never dropped.** With the same supplier legitimately quoted twice, it is the only thing distinguishing two otherwise identical rows.
- **Alternatives**: a `QUOTED PRODUCT` column with an `ALTERNATIVE` chip, the substitute name in bold, the requested name beneath, and the row tinted amber.
- **Photos are a count badge (`📷 3`) opening a lightbox**, never thumbnails. Thumbnail strips ate the horizontal room the numbers needed. Reference Images sit beside Quote Photos on the Item.
- **Three Item-level banners**, stacked above the quote table — never on rows:
  - *Unit mismatch* — one Quote in "box of 50" means **nothing on that Item can be ranked**, including the quotes that are in pieces. No rank numbers, no `lowest` chip anywhere on the Item. Refusing is louder than converting silently.
  - *All Alternatives* — "No exact match. All 3 Quotes are Alternatives to X. The ranking is comparing different products." Row tinting alone is invisible when every row is tinted; the banner is what carries this case.
  - *Too close to call on frozen rates* — shown when the top two are within **3%** and either carries a stale rate. Rates are frozen on different days, so a 1.3% lead can sit entirely inside the drift. Re-marking to today's rate at render time was rejected: it would make the displayed ranking unreproducible from the stored data.
- **Three sourcing states shown as chips on the Item row**: Quoted · No Supplier Found · **Not Yet Sourced**. The difference decides whether it is worth waiting before bidding.
- **Pricing is inline in the Item's row**, not a separate step. Landed cost pre-fills from the Selected Quote and stays editable; selling price beside it; margin computes live as you type. **Selecting a different Quote re-prefills landed cost unless it has been hand-edited.**
- **An Unconfirmed Landed Cost renders margin as provisional, not as a number.** A Landed Cost still sitting at its pre-filled value has had no shipping, duty or handling added, so any margin from it is understated in cost and overstated in profit. Nothing is blocked and nobody is nagged — the figure simply stops pretending to be final. `landed_cost_confirmed_at` is set when a human confirms; inferring "untouched" by comparing against the frozen Quote price breaks the moment shipping is genuinely zero.

### Responsive behaviour

**One responsive design, not two layouts. The breakpoint is 768px.** One rule, applied to the quote list inside an expanded Tender Item. Everything else on every screen is written once and is not breakpoint-aware.

- **≥ 768px** — the dense 9-column table described above.
- **< 768px** — the same nine columns become **one stacked card per Quote**, ranked cheapest-first, rank carried by a numbered pill instead of a column. Each card holds supplier, unit price with THB beneath, line total, the Alternative box where it applies, sourced-by as an inline avatar + name, the photo count badge, and a full-width Select button.

Everything above survives the reflow verbatim — banners stay Item-level and stack above the cards, pricing stays inline and editable per unit with **margin computing live below the fields**, because on a phone the numeric keyboard covers the bottom of the screen.

**The failure bar: no horizontal overflow anywhere.** A table that "works" by scrolling sideways is a failure, not a pass. A builder told only "make it responsive" reaches for a horizontally-scrolling table, which is the one outcome ruled out.

**The accepted cost:** below 768px, rank 1 and rank 8 are never on screen together — about four cards fit a phone screen. Three alternatives were built and set aside (a cut-down rank table with drawers, a two-level drill-down with a sticky pricing bar, a swipe deck); each bought co-visibility back by adding a phone-only interaction the desktop screen does not have. One design that adapts is worth more: one thing to build, one to change, one to keep correct in two locales.

Measured at 390px on the awkward dataset: **189px per quote card**, so the 8-quote stress case is ~2,250px ≈ 2.7 screens for one Item; with decided Items folded, the default landing state across four Items is ~3,400px ≈ 4 screens.

**Judge at 390px on a real phone, not a narrowed desktop window** — tap targets are floored at 44px, which a resized browser will not surface.

**Supported browsers:** Mobile Safari, Chrome Android, and **WeCom's in-app webview**, which is where every reminder link actually lands.

### Notifications

**One outbound integration: the WeCom group-robot webhook.** A plain HTTPS POST to a URL WeCom hands you — no access token, no app credentials, no OAuth, no domain of ours involved. It is the one WeCom surface exempt from every gate this project hit. The webhook URL is a server-side environment variable.

**Both tiers ship**, and together they are the largest single item in v1.

**Targeted reminders**

| Milestone | Who is @mentioned | Default offsets |
|---|---|---|
| `internal_quote` | **only** Assignees who have entered no quotes at all | see [Assumptions](#assumptions) |
| `client_submission` | the Owner | 7, 3, 1 days before, plus morning-of |
| `decision_chase` | the Owner | **off by default**; the Owner sets an absolute date |

A reminder that pings people who already did the work trains everyone to mute the robot within weeks — hence the "no quotes at all" filter on the first row. Decision-chase anchors on `remind_on` because clients rarely state a decision date; every other reminder anchors on `days_before`. One group post fires when a submission is actually missed.

**Outcome notifications** fire on `won` and `lost` only (`no_bid` and `cancelled` are silent) and go to **every Assignee who quoted that Item**, not just the winner — the losers' only feedback on how their supplier compared comes from this message. Wording is differentiated: "your quote was selected and won" against "the tender was won on Nok's quote".

**The daily Digest** posts every open Tender and its next milestone to the group. Reminders only fire at thresholds, so they do nothing for the stated problem of *losing track of what is ongoing*; the Digest attacks that directly for one message a day and reuses the same cron.

**Message content is financially silent.** Format: *"Tender #1042 — Bangkok Hospital — 'PICC catheter 4Fr' — WON @Somchai"*. Client, Item, outcome, mention. **No prices, no margin, no supplier name** — supplier identity is commercially sensitive. Financial detail lives in the app, which the mention drives people to.

**Message text is hardcoded Simplified Chinese** and is not switchable. These are broadcast into a group and rendered once for everyone. This is the app's highest-volume output and it is not a screen, so every screen-based i18n plan misses it.

**Two hard constraints from the WeCom API:** only the `text` message type supports mentions, so **no markdown formatting in any message that @s someone**; and each webhook is capped at **20 messages per minute**.

### The cron job, and its five silent-failure rules

**One Vercel Cron, daily at 01:00 UTC (08:00 Bangkok)** — the start of the Thai working day. It fetches FX rates, then sends reminders, then posts the Digest.

`buildspec_1`'s reminder design was a silent-failure machine in three separate places. For a product whose entire purpose is "we occasionally miss our submission", a reminder that quietly does not fire is the worst possible defect. Five rules, all load-bearing:

1. **Catch up, never skip.** Query `due_date <= today AND NOT sent`, **never** `due_date = today`. Exact date equality means one missed cron run drops that day's reminders permanently. Late beats never.
2. **Suppress caught-up reminders whose milestone date has already passed.** A "7 days before" nudge for a deadline that went by yesterday is noise; Submission Missed covers that case more loudly.
3. **Recompute `due_date` whenever a deadline changes, and clear `sent`/`sent_at` on any row whose new `due_date` is in the future.** A reminder that has not happened yet has not been sent, whatever the flag said before the date moved. Rows recomputing to a *past* date keep their flag, so pulling a deadline forward does not re-spam. Without this, pushing a deadline back leaves every reminder marked done and the Tender goes quiet exactly when it has the most runway left.
4. **Batch per Tender *per cron run*** — across missed days and across both milestones, not merely across Items. This is what keeps a catch-up burst inside the 20-per-minute cap: 10 open Tenders after a three-day outage is ~10 messages collapsed, but up to ~60 if the send path loops pending reminder rows. **Pace sends ~3s apart (≈17/min).** In-app `notifications` rows stay per-Item so the bell can deep-link later.
5. **Never mark a reminder `sent` on a non-zero `errcode`.** The throttle response is unmeasured, so treat any non-zero result as retryable and leave the row unsent — rule 1 then recovers it on the next run for free.

**`errcode 0` means accepted, never notified.** A nonexistent userid and an empty string are each accepted silently and notify nobody. **No "notification delivered" indicator may be built on it.** Each user's `wecom_userid` is verified once by a human: an Org Admin action sends a **test @mention** to one user and that user confirms receipt.

**All date boundaries compute in the org timezone**, never server-local — Vercel runs UTC, which would roll the day seven hours early for every user. Timezone is deliberately **org-level, not per-user**: a deadline is a property of the Tender, not of whoever is looking at it. If two colleagues open the dashboard and see different "coming up" sets, the app is lying to one of them. A colleague working from China (UTC+8) correctly sees Bangkok dates, because they are Taihue's deadlines.

### i18n

**Full `zh-Hans` and full `en`, every screen, user-switchable.** A switcher means both locales must be **complete at launch** — ship a toggle over half-translated strings and the first person to flip it hits raw keys. This is more translation work than a split would have been, but it is translation work rather than engineering work.

- next-intl key lookups from day one; no hardcoded strings in components. Free now, expensive to retrofit.
- `users.locale` is nullable. **When null, the app asks on first start-up** rather than inferring silently.
- **User-entered content is never translated** — tender and quote text stays in whatever language it was typed in.
- WeCom message text is outside this system: hardcoded Simplified Chinese, per above.

---

## Testing Decisions

**A good test here asserts external behaviour and nothing else.** For the cron, that means asserting *the set of messages that would be posted* — not that some internal scheduling function was called. For derived state, it means seeding rows and asserting what the app reports, not unit-testing a helper. Every rule in this spec that is described as a silent-failure mode is a rule whose absence a passing test suite must not tolerate.

**There is no prior art in this repo** — it is greenfield, 42 tracked files and no application code. The prototypes are the visual reference, not a test reference.

### One seam: route handlers over a real local Postgres

Tests call Next.js **route handlers and server actions** against a real local Supabase (`supabase start`). Exactly two outbound boundaries are stubbed: the **WeCom robot webhook** and the **Frankfurter** rate fetch.

This seam is chosen over a pure-domain-module seam because the two riskiest areas do not survive being lifted out of the database. Progress, the three overdue conditions and the list blocks are *queries* — testing them against an extracted function tests something that is not what ships, and derive-on-read is the whole point of the design. And the reminder engine's failure modes are all about **persisted state across runs**: "cron runs, deadline moves, cron runs again" cannot be expressed without a real database.

**This imposes one design constraint: the run instant is injected, never read inside a handler.** The cron entry point takes the instant it is running at, and the org timezone comes from the row. `new Date()` inside business logic makes every date-boundary rule untestable.

### What must have a test

**The reminder engine** — the highest-risk logic in v1:

- A run that is missed and then happens two days later still sends (rule 1), and does not send a nudge for a milestone that has since passed (rule 2).
- Pushing a deadline back re-arms reminders that were already marked sent; pulling it forward does not re-send them (rule 3).
- Ten Tenders with a three-day backlog produce ~10 messages, not ~60, and are paced (rule 4).
- A non-zero `errcode` leaves the row unsent, and the next run retries it (rule 5).
- `internal_quote` mentions only Assignees with no quotes; `client_submission` and `decision_chase` go to the Owner; outcome events reach every Assignee who quoted the Item, including losers.
- Group messages contain no price, no margin and no supplier name.

**Derived state:**

- The Progress table, including that an Item marked `no_bid` does not pin a Tender at `sourcing`, and that deleting the last Quote regresses Progress.
- Tender-level Outcome across all three ordered rules, including `partial`, and that `partial` is never written to a row.
- Each of the three overdue conditions, including that Sourcing Overdue ignores an Item marked No Supplier Found, and that Submission Missed is excluded from the default "active" filter.
- Every Tender lands in exactly one list block.

**Money and ranking:**

- A quote freezes `fx_rate_mid`, `fx_rate_applied` and `as_of` at entry, and the applied rate is mid × 1.02 by default.
- A Frankfurter failure falls back to the last known rate, sets `fx_rate_is_stale`, and **does not block quote entry**.
- A unit mismatch on one Quote removes ranking from the whole Item — no rank numbers and no `lowest` chip anywhere on it.
- The "too close to call" banner appears when the top two are within 3% and either rate is stale.
- Two quotes from the same supplier on one Item are both kept and both displayed.
- Landed cost re-prefills when the Selected Quote changes **unless** it has been hand-edited.
- Margin from an unconfirmed Landed Cost renders provisional; setting `landed_cost_confirmed_at` turns it into a number.
- Totals multiply per-unit figures by `quantity`.

**One automated UI assertion:** at a 390×844 viewport, the comparison working sheet's `scrollWidth` never exceeds its `clientWidth`, on the 8-quote stress dataset. That is ADR-0009's failure bar stated in testable terms, and it is the one outcome the design explicitly rules out. It lives in `src/components/comparison/working-sheet.layout.test.tsx`, runs in headless Chromium (jsdom reports every `scrollWidth` as `0`), and is re-measured at 768/1024/1280 — the same bar at the widths where the dense table comes back, not a second assertion.

### What is checked by hand, not by CI

- **44px tap targets and the density feel** — judged at 390px on a real phone, per above.
- **The WeCom in-app webview path** — the entry path, the camera, and compress-and-upload were measured on an iPhone and pass. Re-check after any change to login or the photo input.
- **Locale completeness** — that no screen shows a raw key in either locale.

---

## Deferred to v1.1, with reasons

These are deferred, not rejected. The reasons are recorded because *"why"* is what stops them being relitigated in three weeks.

**WeCom QR login.** Measured, viable, and cut on cost. It fails the v1 test outright — removing it stops no tender being tracked; it saves under ten users from typing a password on 30-day sessions. Against that: a **second deployment target** (the `code` → `wecom_userid` exchange is IP-gated and Vercel has no stable egress IP, so it needs a fixed-IP host at ~$2–6/mo — a third thing to deploy, monitor and hold secrets for), 1–2 days for a WeCom→OIDC shim plus a callback endpoint, an **unverified risk** that WeCom rejects cloud-provider IPs as third-party, and a **permanent silent-failure mode** if the whitelisted IP ever changes. **The measurements must not be re-run:** the **Authorized callback domain** field carries no ICP filing gate (a plain company domain saved outright), and **Trusted enterprise IP** can be unlocked via **Receive messages server URL**, which is also filing-free. v1.1 is a build, not another investigation. `users.wecom_userid` is already in the schema and already populated.

**The two money cards** — *Bids out with clients* and *Margin won this month*. Deferred on the dashboard's own reasoning: it deleted the count cards because counting is not worth a card at this volume, and two money figures over six tenders are the same argument in a different unit. They answer "how are we doing"; v1 answers "what do I do next". Reversal is two SQL queries — both need **no new columns**. Their definitions, kept so they are not re-derived wrong:
- *Bids out with clients* (THB) — over submitted Tenders with at least one undecided Item: `SUM(selling_price_per_unit × quantity)` for Items whose Outcome is null. An already-won Item is money banked, not money at stake.
- *Margin won this month* (THB) — Items with `outcome = 'won'` and `outcome_at` in the current month: `SUM((selling_price_per_unit − landed_cost_per_unit) × quantity)`. `outcome_at` is what makes this honest; `updated_at` is not a decision date.

**In-app notification bell.** `buildspec_1` called it "baseline, always on". It only ever reaches someone who has already opened the app — the exact person who does not need reminding — and the WeCom channel is strictly stronger. The `notifications` table ships anyway, so the bell is later a read model over rows that already exist.

**Search and filter.** Over six tenders on one screen, search is decoration; Cmd-F does it. The list's default filter is not search and ships regardless. This returns as a fresh ticket the first time someone cannot find a tender from March.

**Historical reporting.** Falls out of the two cuts above — with money cards and search both deferred, nothing in v1 reads closed Tenders in aggregate. The Outcome model exists and written-off Tenders already leave the default list, so the data is complete; only the view is missing.

**Private 1:1 WeCom messages** (`message/send`). IP-gated like everything else, so it needs the same fixed-IP host as QR login. Group messages are already financially silent, so nothing has to change to accommodate the group-only design.

**Directory lookup** (`user/get`). IP-gated. Names are typed by hand — a one-time job under ten invite-only users.

## Out of scope

Not deferred — ruled outside this product. Each returns only as a fresh effort with a redrawn goal.

- **Multi-tenant / platform architecture.** No tenancy model, no cross-org auth boundary, no data-ownership terms. `org_id` as a placeholder column is the entire concession. Deciding this before a second customer exists builds the wrong abstraction.
- **Mainland-China reachability.** Non-goal, stated above and repeated here because it is the analysis most likely to be re-derived from scratch.
- **WeCom org verification (已验证/认证).** It would let `user/get` return name, mobile and email so signup could prefill them — but it costs RMB 300+ and days-to-weeks, on an entity that already failed WeCom's filing-entity check, and it buys two text fields a user can type in seconds.
- **PWA, home-screen install, offline mode and web push.** "Mobile-friendly" drifts into "app-like" by default and each of these is a different project. **Web push is the one that looks free and is not** — it would be a second notification channel racing the group robot, whose delivery semantics took an entire ticket to get right (catch-up, deadline-move reset, one timezone). Two channels means two of those to keep honest, and a user who gets nagged twice or, worse, differently. Offline needs a sync and conflict model this project has no reason to own.
- **A permission model and RLS on cost or margin.** Under ten trusted users, everyone sees everything. If a margin-blind role ever appears, that is a new effort.
- **Billing, an app hub/launcher, and an admin UI for org members.** Org membership is managed by invite and the Supabase dashboard.
- **Data migration / import.** Greenfield — nothing to bring across.
- **Internal email provider (Zoho vs Tencent Exmail).** `buildspec_1` left this open. It is an ops purchasing decision that cannot change a line of the app. Resend handles the one transactional email the app sends, and that does not reopen the mailbox question.
- **A supplier-quotation parent row** grouping the Items one supplier priced together. A supplier pricing three Items produces three Quote rows. Add this later only if quotations need to be treated as atomic all-or-nothing offers.

---

## Assumptions

Everything above traces to a resolved decision **except** the following. Each is a judgment made while writing this spec, or a known unknown carried forward. Any of them can be overturned without disturbing the rest.

| # | Assumption | Why it is here, and what to do |
|---|---|---|
| A1 | **`tenders.reference`** (e.g. `T-1042`) exists as a short human-facing identifier, unique per org, generated from a sequence. | The prototypes and the WeCom message format both assume one, but no decision established it. If you would rather show the client name and title, drop the column and change the message format. |
| A2 | **`internal_quote` default offsets are 3 and 1 days before, plus morning-of.** | Only the `client_submission` escalation (7/3/1 + morning-of) was actually settled. The internal deadline is nearer-term and lower-stakes, so a shorter ramp is proposed. Confirm with the Owner. |
| A3 | **The 2% FX buffer is a placeholder.** | The real spread Taihue's bank charges on THB↔CNY and THB↔USD is outstanding input, flagged as non-blocking. It is a column (`orgs.fx_buffer_pct`) precisely so it can be changed without a deploy. |
| A4 | **Android is unmeasured.** | The WeCom webview path was measured on an **iPhone** — clean page, camera opens straight away, compress-and-upload works, no escape to Safari. No Android device was available. Research notes that Android WebView *"will cancel all file requests"* and that WeCom's opt-in is reported flaky, which makes the camera the sharper risk. **Therefore `capture` is treated as a hint and a visible file-picker fallback is required.** One green iOS row must not be read as covering both platforms. |
| A5 | **The cookie exemption from WebKit's 7-day cap is inferred, not quoted.** | WebKit enumerates what *is* capped (script-writable storage) and never states the exemption for server-set cookies; it follows from the category name. The inference is standard, but it is an inference, and the 7-day cap itself is documented-but-unmeasured in this app. The only *stated* exemption is a home-screen web app, which is out of scope. |
| A6 | **RLS posture** — enabled on all tables, one policy, authenticated + not disabled + matching `org_id`. | Necessary because the anon key reaches the browser; not derived from any decision. No column-level rules, deliberately. |
| A7 | **`unique (org_id, lower(name))` on `suppliers`.** | Follows from the reason suppliers became a table (one supplier must not split across rows), but the constraint itself was not specified. It will reject legitimately distinct suppliers with identical names. |
| A8 | **`tender_items.selected_quote_id`** rather than `quotes.is_selected`. | Structurally enforces one Selected Quote per Item; the boolean allows two. Requires the circular FK to be added after `quotes` exists. |
| A9 | **Numeric precisions** (`numeric(14,4)` for money, `numeric(18,8)` for rates, `numeric(14,3)` for quantity). | Chosen to be comfortably wide. Nothing depends on the exact values. |
| A10 | **A 10 MB per-image upload cap.** | A "hard size cap" was decided; the number was not. Client-side compression happens before upload, so this should rarely bind. |
| A11 | **The currency picker offers Frankfurter/ECB-supported currencies, plus THB at rate 1.** | THB, CNY and USD are the currencies seen in real data. A supplier quoting a currency ECB does not publish has no defined behaviour — reject it at entry with a clear message rather than storing an unconvertible price. |
| A12 | **Blocks 4 and 5 of the tender list** (Awaiting Decision, then everything else) reconcile two sources that each named a different subset of blocks. | The three *action* blocks and the "every Tender in exactly one place" rule are both settled; their composition into one ordered list is this spec's synthesis. |
| A13 | **Storage bucket layout** — one private bucket, paths keyed by org and entity id. | Not specified anywhere. Signed URLs for both read and write are settled. |

---

## Provenance

Not required reading. The decisions above are restated in full and this file does not depend on any of it.

This spec is the terminal output of the wayfinding map [**De-risk the Tender Tracker buildspec**](https://github.com/Mikepeerawit-com/tender-tracker/issues/1) — seventeen tickets over eight days, of which the load-bearing ones were: cardinality ([#2](https://github.com/Mikepeerawit-com/tender-tracker/issues/2)), WeCom login on Supabase ([#3](https://github.com/Mikepeerawit-com/tender-tracker/issues/3)), hosting ([#4](https://github.com/Mikepeerawit-com/tender-tracker/issues/4)), currency ([#5](https://github.com/Mikepeerawit-com/tender-tracker/issues/5)), lifecycle ([#6](https://github.com/Mikepeerawit-com/tender-tracker/issues/6)), the WeCom console registration ([#7](https://github.com/Mikepeerawit-com/tender-tracker/issues/7)), auth ([#8](https://github.com/Mikepeerawit-com/tender-tracker/issues/8)), notifications ([#9](https://github.com/Mikepeerawit-com/tender-tracker/issues/9)), the comparison view ([#10](https://github.com/Mikepeerawit-com/tender-tracker/issues/10)), dashboard metrics ([#11](https://github.com/Mikepeerawit-com/tender-tracker/issues/11)), v1 scope ([#12](https://github.com/Mikepeerawit-com/tender-tracker/issues/12)), the QR-login gate measurements ([#14](https://github.com/Mikepeerawit-com/tender-tracker/issues/14)), mention targeting ([#15](https://github.com/Mikepeerawit-com/tender-tracker/issues/15)), the phone-width working sheet ([#17](https://github.com/Mikepeerawit-com/tender-tracker/issues/17)), the WeCom webview research ([#18](https://github.com/Mikepeerawit-com/tender-tracker/issues/18)) and the on-device probe ([#19](https://github.com/Mikepeerawit-com/tender-tracker/issues/19)).

Nine ADRs in `docs/adr/` carry the arguments in full; three research files in `docs/research/` carry the WeCom measurements; `CONTEXT.md` is the glossary and is the one file that should be read alongside this one.

# De-risk the Tender Tracker buildspec

Label: `wayfinder:map`

## Destination

A rewritten **`buildspec_2.md`** at the repo root: every load-bearing claim in `buildspec_1` either verified, replaced, or explicitly deferred — readable standalone by a fresh build session with no access to this map, so implementation can start without further discovery.

## Notes

**Domain.** Tender/RFQ tracking for a Thailand-registered medical-supplies trading company (Taihue), whose workspace is WeCom and whose staff read Simplified Chinese. First module of an eventual internal-tools platform, but see Out of scope.

**Skills every session should consult.** `/grilling` and `/domain-modeling` by default; `/research` for research tickets; `/prototype` for prototype tickets. Maintain `CONTEXT.md` as terms are settled — the cardinality and lifecycle tickets will generate real vocabulary.

**This map plans, it does not build.** The only ticket that produces app code is none; ticket 12 writes the spec. Resist the pull to implement.

**Established at charting** (not tickets — constraints all tickets inherit):

- Solo developer + Claude Code. No external deadline.
- Scope is **negotiable** — "cut this feature" is a valid resolution to any ticket.
- `org_id` exists on every table as a placeholder column, populated with one value, never queried by. Taihue is owned by the same party building the vendor product, so there is no real two-party boundary in v1.
- Greenfield: no existing data to migrate, no legacy system to mirror.
- Under 10 users, all trusted, **all** may see cost/selling price and margin. Collapse `role` to a single role for v1; no RLS on financial columns.
- The user is the admin of Taihue's WeCom — no third-party access blocker.
- Default auth posture: email/password ships first, WeCom login is a fast-follow. Ticket 07 may overturn this against evidence.
- The app must work internationally; a single-geography hosting assumption is not safe.

**Repo prerequisites — not yet done.** `git init` has not been run. `/prototype` keeps its output on a `prototype/<name>` branch, `/research` leaves files in the repo, and `/implement` closes with `/code-review` against a fixed point — none work without a repo. Also `/setup-matt-pocock-skills` has never been run; this map defaulted to the local-markdown tracker because nothing was configured. Switching trackers is cheap now and painful once tickets carry resolutions.

**Open question awaiting the user** (asked twice, not yet answered sharply): **is anyone who actually uses this app physically in mainland China?** "Should be international" was the answer given, which is not the same thing — Chinese-reading staff in Thailand is a different situation from staff in Shenzhen, and HK/Taiwan/Singapore sit outside the GFW. This decides whether ticket 03's ~$35/month hardening is necessary or merely nice; it does **not** affect the ICP problem, which is enforced at configuration time regardless of location. Not blocking — the frontier is takeable either way.

**Suggested ticket order** (diverges from plain frontier order, so stated explicitly): take **06** first — five minutes of console work that settles the map's largest unknown, and every other ticket is more expensive to resolve while it's open. Use `/wizard`; it's HITL dashboard work with credentials to capture. Then **01** (the one ticket that can invalidate others — resolving it early stops the prototypes being built twice), then **05** and **04**, which between them unblock both prototype tickets.

**Hand-off when the map clears:** `/to-spec` → `/to-tickets` → `/implement` per ticket, clearing context between each. See ticket 12.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [What WeCom login on Supabase actually requires](issues/02-wecom-login-on-supabase.md) — Supabase now *does* have custom OAuth/OIDC providers (GA 2026-04), but WeCom isn't standards-compliant OAuth2 (no token endpoint, app-scoped token, code redeemed at userinfo), so a **WeCom→OIDC shim is mandatory** — 1–2 days. The real blocker is administrative: the 可信域名 must be **ICP-filed under Taihue's own entity** (so `*.vercel.app` is unusable) and requires an **已验证/认证** WeCom org. Treat email as absent; key identity on `wecom_userid`.
- [Hosting and reachability for international users](issues/03-hosting-reachability.md) — **keep Vercel + Supabase**, with four cheap changes (custom domain, Supabase Custom Domain add-on, Singapore region, direct-to-Storage compressed uploads). Reachability collapses to one unanswered question: is any user *physically* in mainland China? But independently: **ICP filing requires a mainland entity *and* mainland-hosted servers**, so an ICP-filed domain and Vercel are mutually exclusive — which makes WeCom web-OAuth login effectively unavailable. **Group robot webhooks are exempt from all of it**; the notification design stands.
- [Tender, product and quote cardinality](issues/01-tender-product-quote-cardinality.md) — a **Tender has many Tender Items**; a Quote prices exactly one Item. Item counts vary by client, so the model carries the harder case. Adds `tender_items` and a `suppliers` table; adds **quantity/unit**, absent from `buildspec_1` entirely; unit mismatches **refuse to rank** rather than convert silently. Outcome turns out to be per-Item. ([ADR-0002](../../docs/adr/0002-tender-item-cardinality.md))
- [Multi-currency](issues/04-multi-currency.md) — Reporting Currency is **THB** for both comparison and dashboard. Rates from **Frankfurter** (MIT, no key, no quota, commercial-safe; ECB mid-market, business days only), **frozen onto the Quote** at entry with a conservative **2% buffer** — ECB mid is not what the bank charges, and the error must fall on the side of overstating cost. Cost is **Landed Cost** (editable, pre-filled) because supplier prices often exclude shipping.
- [Tender lifecycle and status model](issues/05-tender-lifecycle.md) — the `status` enum splits: **Progress derived and never stored**, **Outcome stored per Tender Item**. There is deliberately no `status` column. "The deadline passes" was the wrong question — there are **three deadlines**, and "overdue" is three unrelated conditions with three different audiences. ([ADR-0001](../../docs/adr/0001-derived-progress-stored-outcome.md), [ADR-0003](../../docs/adr/0003-three-date-lifecycle.md))
- [Notification and reminder model](issues/08-notification-and-reminder-model.md) — the ticket's premise was wrong: group robots *can* target individuals via `mentioned_mobile_list` (phone number, no WeCom login, no ICP), so **06 no longer gates this ticket**. Targeted per-milestone reminders, a `notifications` table, a daily **Digest**, financially-silent group messages, and **No Supplier Found**. Reminders **catch up rather than skip**, **reset when a deadline moves**, and anchor to an org timezone — `buildspec_1`'s exact-date match and write-once `sent` flag were both silent-failure bugs. ([ADR-0005](../../docs/adr/0005-reminder-delivery-semantics.md))
- **Assignment model** — Assignees **compete rather than divide**: several users work one Tender, each sourcing every Item through their own suppliers, because comparing their Quotes is the point. No unique constraint on `(item, supplier)`. ([ADR-0004](../../docs/adr/0004-assignees-compete-not-divide.md))

## Not yet specified

In-scope fog — visible, not yet sharp enough to ticket. Graduates as the frontier advances.

- **i18n completeness bar at launch.** Which surfaces must be Simplified Chinese on day one vs English-first. Hangs on the v1 scope cut (11) — there's no point pinning translation scope to screens that may not ship.
- **Quote photo handling.** Supabase Storage is chosen, but nothing is decided about upload size limits, compression/thumbnails, whether images are public or signed-URL, or retention. Depends on the quote model (01) and on how prominently photos feature in the comparison view (09).
- **Search and filter on the tender list.** "Search + status filter" is a label. What is searched (client, product, supplier?), and whether it's client-side or a Postgres query, depends on the cardinality decision (01).
- **User onboarding without an admin UI.** How the first accounts come into existence when member management is "manual via Supabase dashboard." Downstream of the auth decision (07).
- **What happens to a tender after won/lost.** Archival, historical reporting, whether closed tenders leave the default list view. Depends on the lifecycle model (05).
- ~~**Tender ownership: single owner or shared.**~~ **Resolved** — both. `owner_user_id` stays (the Owner is accountable for the client relationship and the Bid going out) alongside a many-to-many Assignee join table. See [ADR-0004](../../docs/adr/0004-assignees-compete-not-divide.md).
- ~~**Timezone handling.**~~ **Resolved** — org-level timezone column, `Asia/Bangkok` default, every date boundary computed in it; explicitly not per-user and never server-local. See [ADR-0005](../../docs/adr/0005-reminder-delivery-semantics.md).
- **Archival after won/lost.** Partially resolved — the Outcome model exists, but whether closed Tenders leave the default list view, and any historical reporting, is untouched. Now downstream of 10 rather than 05.

## Out of scope

Ruled beyond the destination. Never graduates; returns only as a fresh effort.

- **Multi-tenant / platform architecture.** No tenancy model, no cross-org auth boundary, no data-ownership terms. `org_id` as a placeholder column is the entire concession to the future. Deciding this before a second customer exists builds the wrong abstraction.
- **Internal email provider (Zoho vs Tencent Exmail).** An ops purchasing decision that cannot change a line of the app. Real, but not this map's.
- **Billing, app hub/launcher, admin UI for org members.** Already out of scope in `buildspec_1`; restated so no ticket drifts into them.
- **Data migration / import.** Greenfield — nothing to bring across.
- **Permission model and RLS on cost/margin.** Settled at charting by constraint, not investigation: under 10 trusted users, everyone sees everything. If a margin-blind role ever appears, that's a new effort.

# 11 — v1 scope: what actually ships

Type: grilling
Status: open
Blocked by: 07, 08, 09, 10

## Question

Scope is negotiable, and by this point the cost of everything is known: the auth path (07), the notification design (08), and two prototypes that revealed what the core screens really take (09, 10). Now cut.

Decide the actual v1 from `buildspec_1`'s five screens plus notifications:

1. Login
2. Tender list / dashboard
3. Add/edit tender
4. Add quote form
5. Tender detail / quote comparison
6. Deadline reminders (in-app bell + WeCom group robot)

**The test for each item:** does removing it stop the first real tender from being tracked end to end? Anything that survives only because it was in the original spec should be defended or dropped.

Specifically confront:

- **The dashboard metric cards.** Whatever survived 10 — do they ship in v1, or after there's enough data to make them non-trivial? A dashboard over 6 tenders is decoration.
- **Reminders.** The heaviest infrastructure in the app (cron, a table, an external webhook, failure semantics) for a workflow that under 10 people currently handle in a WeCom group by hand. Is it v1 or v1.1?
- **WeCom login**, per 07's decision — restate it here so the cut is recorded in one place.
- **i18n scope**, which has been sitting in the map's fog waiting for exactly this ticket. Which surfaces are Simplified Chinese at launch?

---

## Added after ticket 03 — running cost is now a scope input

03's recommended hardening isn't free, and `buildspec_1` implicitly assumed free tiers ("Taihue is the free early-access design partner"). Real monthly floor: **Supabase Pro $25 + Custom Domain add-on $10 = $35/month**, plus ~$12/yr for a domain, plus ~$5/month if a fixed-IP VM turns out to be needed for WeCom server APIs.

Decide here: is that acceptable, and **who pays it** — you as the vendor absorbing it during the free design-partner period, or Taihue? Note the $10 Custom Domain add-on drags in the $25 Pro plan, so the marginal cost of that one hardening step is really $35. If the mainland-user question comes back "nobody," its value drops considerably and it becomes a judgement call rather than a necessity.

---

**Answer must record** what ships, what is deferred, and *why* for each deferral — ticket 12 turns the deferrals into `buildspec_2`'s "not in v1" section, and "why" is what stops it being relitigated in three weeks.

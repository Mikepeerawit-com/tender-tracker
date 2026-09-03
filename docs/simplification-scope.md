# Simplification: what ships, what doesn't, and how we'll know

Settled 31 August 2026. The concern that opened it: the interface is hard for a
competent computer user, and the people who will actually use it are less confident than
that. The decisions live in [ADR-0020](adr/0020-an-assignee-sees-their-own-quotes-and-no-money.md),
[ADR-0021](adr/0021-two-destinations-and-the-device-follows-the-role.md), the
[ADR-0017 amendment](adr/0017-the-first-org-admin-arrives-through-a-guarded-setup-screen.md),
and `CONTEXT.md`'s new label layer. This file holds what those don't: the scope line, the
check, and the things deliberately left alone.

## The diagnosis

The interface is not badly built; it faithfully exposes a domain of ~39 defined terms to
everybody at once. Three screens carry nearly all of it — `/tenders/[id]` (50+ controls on
a four-item Tender), the quote form (25–40), and the tender edit screen (30+). The
worklist itself is already sparse. So the work is concentrated, not general.

## In scope

1. **Two destinations** — *My work* (Item-grained, Not Yet Sourced only) and *Tenders*.
   ADR-0021.
2. **The role split** — an Assignee sees their own Quotes and no money. ADR-0020. This is
   the single largest reduction on the densest screen.
3. **The label layer** — domain terms stay; the interface is free to say something a new
   colleague understands. Recorded per-term in `CONTEXT.md`. Worst English strings first:
   "Digest", "Landed cost", "Margin on line", "Group Robot", "Org Admin".
4. **One label per state** — "Provisional" wins, "Unconfirmed" leaves the interface.
5. **The `zh-Hans` terminology fixes** — 负责人 currently means *both* Owner and Assignee,
   and one error string has already given up and parenthesised "（Owner）" in English. Also
   four words for Tender Item and two for Tender. **This ships before the role split**,
   because a role split needs a language that can express the roles.
6. **Field hints cut, section hints kept.** A hint under a field is re-read every time by
   everyone; a hint under a section heading teaches a concept once. The quote form goes
   from ~9 hints to ~3 — keep the two deadlines, the Alternative radio, No Supplier Found;
   drop supplier name, notes, lead time, quantity, unit.
7. **Icons beside labels, never instead of them** — extending ADR-0019's rule that colour
   never carries the only copy of a meaning. No icon-only controls, in either script.
8. **Desktop composition** for the Owner's screens. ADR-0021.

## Explicitly not in scope

- **Multi-org.** Direction agreed and its constraints recorded in the ADR-0017 amendment;
  none of it is built here. It is a new product surface and changes nothing about whether
  a colleague can enter a Quote.
- **Anything for scale.** Under ~25 open Tenders, search, filters, pagination and
  collapsible groups solve a problem that does not exist.
- **The cross-timezone Client Submission Deadline.** Real risk, unproven frequency.
  Deadlines are dates, not moments, so "5 November" means different things in Bangkok and
  Frankfurt and nothing records which the client meant. Modelling it properly touches the
  schema, every reminder offset, the Digest, Sourcing Overdue, Submission Missed and every
  date input in two languages. Until it is seen to bite, the Owner writes the real time in
  the Tender's notes. **Note the org timezone setting does not solve this** — that is our
  clock, not the client's.
- **An FX buffer setting.** `orgs.fx_buffer_pct` has no UI and changing it needs SQL
  against production. It is a live commercial lever and should get a screen, but it is an
  Org Admin concern and does not touch the literacy problem. Its own ticket.
- **A help page or a guided tour.** See below.
- **A Thai UI.** Deferred; nobody currently needs it.

## Guidance: what replaces a manual

A help page is the tax paid for an interface that did not get simple enough, and a tour is
dismissed once and never found again. What ships instead, in order of how well it works
for someone who will not read:

1. **Empty states** — already good, and they appear exactly where a person is stuck.
2. **The Group Robot message itself** — it is read in WeCom, where these users already are,
   and it is the only surface guaranteed to be seen. Wording it as an instruction teaches
   at the moment of need and costs nothing to maintain. Shipped in
   [#99](https://github.com/Mikepeerawit-com/tender-tracker/issues/99): every reminder
   line now names the role it addresses — 参与人 or 负责人 — the verb, and the screen or
   control the verb happens on, and the daily summary carries the same once in its footer.
   `src/lib/wecom/messages.test.ts` holds it there with a rule that goes red on a message
   asking the reader for nothing.
3. **A 60-second screen recording pinned in the WeCom group**, in Chinese, when people are
   onboarded. Re-watchable, no code, no translation debt.
4. **Five minutes of the Org Admin's time**, per person. For ten people this beats every
   mechanism above. Guidance-in-software is what you build when you cannot reach your
   users; here you can.

Rejected: hints that retire once a user has performed an action. It needs new per-user
state, new logic on every hinted control, and it makes two people looking at the same
screen see different things — a support problem in an org of ten.

## How we'll know it worked

**No colleague will test this before it ships.** That is a deliberate choice and it means
every decision here is one person's intuition, unaudited. Two things follow: where two
designs were close, the more reversible one was chosen; and the human acceptance test —
*a colleague, untrained, records a Quote on their phone in under two minutes* — is not
available as a gate.

**What replaces it is a machine check, and it must be able to fail** ([ADR-0016](adr/0016-a-check-must-be-able-to-fail.md)).
The harness already existed and was unused for this: `vitest.config.mts` runs a `layout`
project in headless Chromium at 390×844, and `src/test/layout.ts` exports
`expectNoSidewaysScroll()` and **`controlRows()`, which counts distinct `offsetTop` among
links and buttons** — a density metric that had never been used as a budget.

It is one now. `src/components/density.layout.test.tsx` (#98) holds three:

- `/tenders/[id]` **for a non-Owner Assignee viewer**, on the several-Item,
  several-Quote fixture — **8 rows**, in both locales.
- The sourcing screen an Assignee records a price on — **10 rows** in English, **9** in
  `zh-Hans`, where two photo buttons that wrap in English do not.
- The quote form within it — **2 rows**, in both locales. The screen's total alone would
  sit still while a row moved from a Quote onto the form.

All three are set at what the *new* design produces, with no headroom, so the test locks
the reduction in rather than describing today. They are asserted as exact counts and not
as ceilings: a ceiling goes on passing when a screen quietly stops drawing something, and
at that moment it is a budget above what the screen renders. Each was confirmed able to
fail by producing the failure — a control added, and one taken away — rather than by
reading for it. The desktop assertions above 1280px, which did not exist when this was
written, arrived with #97 — `screens.layout.test.tsx` now pins the column each screen
commits to at 1440×900 rather than only asserting that nothing overflows.

This measures density, not comprehension. It is a proxy and a crude one. It is also the
only thing that will tell anyone in three months whether this work helped.

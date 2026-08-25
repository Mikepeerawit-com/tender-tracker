# Reminders catch up, reset when deadlines move, and anchor to one timezone

> **Rule 2 is narrowed by [ADR-0015](0015-the-missed-submission-is-a-reminder-row.md).** "Suppress a caught-up nudge whose milestone date has passed" turns out to be a rule two of the four Milestones invert, so where a Milestone goes quiet is now a property of the Milestone rather than of reminders in general. Every other decision below stands, and stands for all four.

`buildspec_1` matched reminders with `submission_deadline - today = days_before` and marked them `sent` once, forever. Both halves are silent-failure machines: an exact date match means a single missed cron run drops that day's reminders permanently, and a `sent` flag that is never cleared means pushing a deadline back leaves every reminder for it marked done — so a Tender goes quiet exactly when it has the most runway left. For a product whose stated purpose is "we occasionally miss our submission to the client", a reminder that silently doesn't fire is the worst possible defect.

## Decisions

- **Store a computed `due_date` on each reminder row** and query `due_date <= today AND NOT sent`, never `= today`. Late beats never.
- **Suppress caught-up reminders whose milestone date has already passed.** A "7 days before" nudge for a deadline that went by yesterday is noise; the Submission Missed condition covers that case more loudly.
- **Recompute `due_date` whenever a deadline changes, and clear `sent`/`sent_at` on any row whose new `due_date` is in the future.** A reminder that hasn't happened yet has not been sent, whatever the flag said before the date moved. Rows recomputing to a past date keep their flag, so pulling a deadline *forward* doesn't re-spam people.
- **All date boundaries compute in an org-level timezone, defaulting to `Asia/Bangkok`.** The cron runs at 01:00 UTC (08:00 Bangkok), landing at the start of the Thai working day.

## Consequences

- **Timezone is deliberately org-level, not per-user.** A deadline is a property of the Tender, not of whoever is looking at it — if two colleagues open the dashboard and see different "due this week" sets, the app is lying to one of them. A future mainland-China user (UTC+8) correctly sees Bangkok dates, because they are Taihue's deadlines. Per-user timezones would look like a courtesy and would quietly break every shared metric.
- Server-local time is never used. Vercel runs UTC, which would roll the day seven hours early for every user.
- **The catch-up burst stays inside the group robot's 20-messages-per-minute cap only if batching collapses per Tender _per cron run_** — across missed days and across both milestones, not merely across Items. This ADR previously claimed the cap was safe "because notifications are already batched per Tender", which bounds messages per Tender per *event* and says nothing about a three-day backlog landing in one run. Measured out in ticket 14: 10 open Tenders after a 3-day outage is ~10 messages collapsed, up to ~60 if the send path loops pending reminder rows. Pace sends ~3s apart (≈17/min).
- **Never mark a reminder `sent` on a non-zero errcode.** The throttle response is unmeasured, so treat any non-zero result as retryable and leave the row unsent — the catch-up rule above then recovers it on the next run for free.
- **`errcode 0` means accepted, never notified.** Ticket 14 confirmed this holds for *both* mention routes: a nonexistent userid and an empty string are each accepted silently and notify nobody. No "notification delivered" indicator may be built on it; each user's mention identifier is verified once by a human confirming receipt.
- **Mentions target `mentioned_list` (userid), not `mentioned_mobile_list`.** Both bind, but a mis-formatted mobile fails *systematically* — the natural Thai local format binds for nobody — while a typo'd userid drops one person. The userid comes from the console (Contacts → member → Account), so this needs no IP-gated API and does not depend on WeCom QR login shipping. See [ticket 14](https://github.com/Mikepeerawit-com/tender-tracker/issues/15).

## Settled while building #33

Three readings the rules above leave open, decided here and pinned by tests in
`src/lib/reminders/send.test.ts`.

- **A milestone that has been *met* is suppressed like one that has passed.** Rule 2 is
  written about the deadline going by, but a Tender whose Bid has gone out has met its
  client deadline and spent its internal one — the same reading `worklistBlock` takes when
  it refuses to call a submitted Tender "coming up" — and one whose Items have all been
  decided is off the worklist entirely. Nagging either is chasing finished work. Suppressed
  rows are marked `sent`, not left pending: they are settled, and a deadline that later
  moves re-arms them through rule 3 anyway.
- **An internal-quote nudge with nobody to @ is not posted; one with nobody *assigned*
  is.** Those are opposite facts. Every Assignee having answered means the work is done and
  the group needs no message. A Tender with no Assignees at all means nobody is sourcing
  it, which is the news — so it posts, unmentioned.
- **"Assignees who have entered no quotes at all" means no *answer* at all, No Supplier
  Found included.** buildspec_2 words the filter in terms of Quotes, and CONTEXT.md words
  No Supplier Found as the record that "silences the sourcing nag for them". Reading the
  first literally would ping the one person on the Tender who rang round every Item and
  reported back — which is precisely the behaviour the filter exists to prevent. So an
  Assignee is @-ed while they have entered no Quote **and** at least one Item they have not
  recorded No Supplier Found on. This is still not the worklist's Sourcing Overdue rule:
  that one asks whether *anybody* has answered for an Item.
- **A Disabled colleague is never @-ed.** They read nothing and can act on none of it, so
  the mention would put a name in the company group that answers to nobody.
- **In-app rows are per Item only where the Milestone is.** The client submission deadline
  is about the Tender — there is no Item it could deep-link to, and a row per Item would be
  one sentence repeated five times. The internal quote deadline is about Items somebody
  still has to price, so it writes one row per Item that Assignee has not answered for,
  which is what stops the collapse to one WeCom message collapsing the deep links with it.
- **`notifications.body` holds the milestone's date, not a sentence.** ADR-0012 puts the
  robot's text outside `next-intl` because a group message has no reader whose locale could
  select between two versions. A notification row has exactly one reader (`user_id`), so
  that argument does not carry: the wording belongs in `src/messages/` and is rendered from
  `type`, the row's ids and this date when the bell is built. A Chinese sentence stored here
  would be the one string in the app that an `en` user could never escape.

**Still open:** the `internal_quote` offsets (3 and 1 days before, plus morning-of) are
buildspec_2's assumption A2, not a settled decision — only the `client_submission`
escalation was. They are `reminderOffsets` in `src/lib/reminders/schedule.ts`, one line to
change once the Owner confirms.

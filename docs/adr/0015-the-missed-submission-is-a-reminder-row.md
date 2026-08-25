# The missed submission is a Reminder row, and the outcome news is not on the cron

Ticket 34 ([#34](https://github.com/Mikepeerawit-com/tender-tracker/issues/34)) adds the last three messages the robot sends: the missed submission, the outcome news, and the decision chase. [ADR-0005](0005-reminder-delivery-semantics.md) settles how a reminder is delivered and [ADR-0012](0012-what-the-group-robot-may-say.md) settles what it may say. What was left open is **where each of the three lives** — and two of them do not go where the obvious reading puts them.

## Decisions

- **Submission Missed is announced by a `reminders` row**, milestone `submission_missed`, `days_before = -1`, so its `due_date` is the day *after* the Client Submission Deadline. It is not a nightly sweep over Tenders deduped against `notifications`.
- **The decision chase is a `reminders` row too**, milestone `decision_chase`, anchored on `remind_on` rather than an offset, and **written only when the Owner has set an expected decision date**. Off is the absence of a row.
- **Suppression is a property of the Milestone**, not one rule applied to all of them. `submission_missed` inverts ADR-0005's rule 2 and `decision_chase` inverts the "the Bid went out" test; both live in `milestoneRules` in `src/lib/reminders/send.ts` alongside the audience.
- **A silenced row is either settled or *held*, and the difference is load-bearing.** A row settles when there will never be anything to say; it is held — neither posted nor closed — when there is nothing to say *today*.
- **The outcome news fires on the write, not on the cron**, from `setItemOutcome`, and a failed send never fails that write.
- **The outcome news is two messages when there are two audiences**, not one message with a combined @-list.

## Why the missed submission is a row rather than a sweep

The sweep is the obvious design: every night, find Tenders whose deadline has passed with `submitted_at` still null, post about each, and write a `notifications` row so it is not posted again. The schema even invites it — the comment on `notifications` says reminders need it "for dedupe and catch-up".

It is the wrong shape here, and the reason is that **this is the message that can least afford a bespoke delivery path**. It is the loudest thing the app says and the failure the whole product exists to prevent. Every property ADR-0005 spent five rules establishing has to hold for it, and as a reminder row every one of them holds for free and is already under test:

- `sent` is the dedupe, so the group is told **once** rather than every morning afterwards. A dedupe built on `notifications` would be a best-effort insert on a table whose write is deliberately non-fatal — the one place a duplicate would become a daily duplicate.
- Rule 1's `<=` query catches it up after an outage instead of losing the one morning it mattered.
- Rule 5 leaves it to retry on a non-zero errcode.
- **Rule 3 re-arms it.** A client who grants an extension re-dates the row, and because the new date is in the future the `sent` flag is cleared — so a Tender missed, extended and missed again is announced twice, which is the truth. A sweep would need to rediscover that, and the natural implementations of it do not.

The cost is one migration line widening a CHECK. The benefit is that the message with the highest stakes runs on the path with the most tests.

**`days_before = -1` is the sign that makes it correct.** The cron fires at 08:00 Bangkok; at 08:00 on the deadline itself the Bid can still go out and nothing has been missed. An offset of `0` would announce a miss to the whole company every morning somebody was still working on it.

## Why suppression belongs to the Milestone

ADR-0005's rule 2 — suppress a caught-up nudge whose milestone has passed — reads as universal, and it is not. `submission_missed` exists *because* the date went by, so rule 2 applied to it would silence the message on the only day it could ever be sent. `decision_chase` inverts a different test: the two countdowns go quiet once the Bid has gone out, and the chase goes quiet when it has *not*, because there is no decision coming on something nobody submitted.

Two of four milestones inverting a rule is not a rule with exceptions; it is a rule that was always the Milestone's own. So `milestoneRules` now carries `verdict` next to `audience` and `deepLink`, and only "somebody has decided every Item" is asked once for everybody. CONTEXT.md already stated the audience as a property of the Milestone; this extends the same reading to the other two.

## Why a held row is not a settled one

The obvious reading of "this milestone has nothing to say" is "mark it done". It is right for three of the four and wrong for the decision chase, and the wrongness is a silent failure of exactly the kind ADR-0005 was written against.

A chase is silenced when the Tender has no `submitted_at`. But **"nobody recorded the submission" is a far commoner reason for that than "the Bid never went out"** — recording it is a manual act on a screen, and the app cannot tell the two apart. Settle the row and the chase never fires again, even after somebody fixes the record; the Owner asked to be reminded on a date, the date passed in silence, and nothing anywhere says why.

So it waits. What ends the wait either way is an Outcome — which is also what takes a Submission Missed Tender off the worklist. One rule, read the same way in both places, and rule 1's `<=` query makes holding a row free.

## Why the outcome news is not on the cron

Every other message answers **"what is coming up"**, which is a question about today and belongs to a job that runs once a day. This one answers **"what just happened"**, and a win announced at 08:00 tomorrow is news everybody already had from whoever took the call. Putting it on the cron would also mean inventing a queue for it, because there is no dated row to fire from — and the queue's dedupe would be exactly the `notifications`-table design rejected above.

It rides the same robot seam, the same financial-silence rules and the same pacing. Only the trigger differs.

**A failed send does not fail the write, and that is the opposite call from the reminder schedule.** `scheduleReminders` rolls its Tender back, because a Tender with no reminders is invisible right up to the morning it is too late. Here the Outcome is a fact already recorded, and `setItemOutcome` refuses to re-date an Outcome an Item already has — so a user sent back to retry would save again, send nothing, and be told it worked. Reporting failure would cost them their Outcome and buy them nothing.

The same asymmetry decides the bell rows. The reminder path writes `notifications` only for a message WeCom accepted, because a refused reminder is retried tomorrow and writing them now would double them. The outcome news fires once and is never retried, so its rows are written whatever the send does — otherwise a refused post leaves the Assignee who lost told by nothing at all.

## Why the outcome news is two messages

The spec differentiates the wording: *"your quote was selected and won"* against *"the tender was won on Nok's quote"*. WeCom renders one body for everyone in the group, so a single message cannot say both. Wording vague enough to be true for both audiences is wording nobody acts on.

It collapses back to one whenever there is only one audience — the sole quoter, who was also the one we bid — and to one unattributed message when the Item was decided with no Quote ever selected, which is ordinary on a `lost` Item nobody got round to picking from.

**Naming the colleague is the disclosure ADR-0012 permits in the same breath as forbidding the supplier's name.** Who we bid on is who to go and ask; the supplier behind it is commercially sensitive. The two are one sentence apart in the message and are not the same fact.

## Consequences

- `reminders.milestone` accepts four values. A fifth is **five** edits, and the type checker names four of them: `reminderMilestones`, `milestoneRules` and `milestoneLines` are exhaustive `Record`s over the milestone union, and `dateFor`'s `switch` fails to compile without a branch. The fifth, `reminderOffsets`, is keyed by `OffsetMilestone` and so says nothing about a milestone that carries no offset — the one site to check by hand.
- **The outcome news is outside the 20-per-minute budget, and ADR-0012 named this the moment to revisit that.** It said pacing is per batch, deliberately not process-wide, and to reconsider "the first time a second batch caller can run concurrently with the cron". This is that caller. It is still not made process-wide, for the reason given there — Fluid Compute reuses some instances and not others, so module state would be a false comfort rather than a cap — and the residual is bounded by how fast humans record Outcomes: at most two messages each, on a screen, one decision at a time. Revisit again if Outcomes ever become bulk-editable.
- **This adds the first log line in `src/`.** A refused outcome post has no row to leave unsent and no next run to recover it, which is the one respect in which it is weaker than a reminder, so it is written to the server log with WeCom's own words and never the webhook. The durable half is the `notifications` row, which is written whatever the send does — the recipient is told in the app even when the group is not.
- **`webhookFor` now reports a blank URL as no robot.** It previously passed `""` through, and `sendGroupMessages` *throws* on a blank — so one malformed row would have aborted the whole nightly run for every other org, and would have thrown out of a path documented as never failing the write it rides on.
- **A Tender's `expected_decision_date` is now load-bearing rather than a note.** Clearing it deletes the chase row; moving it re-dates that row in place and re-arms it if the new day is ahead. The field's hint says so on both locales, because a date that silently turns a group post on is a date somebody will set by accident.
- The reconcile matches an existing row to a planned one on milestone **and offset**, never on the date. Pairing on the date would orphan the chase every time the Owner moved it — deleting the sent row and inserting a fresh unsent one, which is rule 3 inverted.
- `setItemOutcome` takes a `RobotBoundary`, like `sendTestMention` and `sendDueReminders`. It is the third caller of the one stubbed outbound boundary, and the first that is not a cron or an admin action.
- `notifications.body` on an outcome row holds `selected` or `not_selected` — which of the two wordings this reader gets — for the same reason a reminder row's holds a bare date. A notification has exactly one reader, so unlike a group message it can be translated, and the sentence belongs in `src/messages/`.

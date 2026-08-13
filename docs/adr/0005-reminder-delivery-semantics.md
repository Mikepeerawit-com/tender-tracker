# Reminders catch up, reset when deadlines move, and anchor to one timezone

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

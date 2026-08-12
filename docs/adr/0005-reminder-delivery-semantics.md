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
- The catch-up burst after an outage stays well within the group robot's 20-messages-per-minute cap because notifications are already batched per Tender.

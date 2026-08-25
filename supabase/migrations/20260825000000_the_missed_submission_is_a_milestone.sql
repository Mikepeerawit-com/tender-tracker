-- The missed submission joins the other three milestones as a `reminders` row, rather
-- than being swept for on every run and deduped against `notifications`.
--
-- It is the loudest thing the robot says and the failure this product exists to prevent,
-- so it is the message that can least afford a bespoke delivery path. As a reminder row
-- it inherits, for free and already tested, every rule ADR-0005 exists to enforce: `sent`
-- is the dedupe, so the group is told once rather than every morning; the `<=` query
-- catches it up after an outage instead of losing it; a non-zero errcode leaves it to
-- retry; and moving the client deadline re-dates it and — when the new date is still
-- ahead — un-sends it, so a Tender missed, extended and missed again is announced twice,
-- which is the truth.
--
-- Its anchor is `days_before = -1`: the day *after* the Client Submission Deadline. The
-- cron fires at 08:00 Bangkok, and at 08:00 on the deadline itself the Bid can still go
-- out — nothing has been missed yet.
alter table reminders drop constraint reminders_milestone_check;

alter table reminders add constraint reminders_milestone_check
  check (milestone in (
    'internal_quote',
    'client_submission',
    'submission_missed',
    'decision_chase'
  ));

comment on column reminders.milestone is
  'Which dated thing this row is counted from. internal_quote and client_submission count back from their deadline by days_before; submission_missed counts *forward* from the Client Submission Deadline by one day, because a deadline has not been missed until it has passed; decision_chase carries no offset at all and fires on the Owner''s absolute remind_on.';

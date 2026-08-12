# A Tender has three deadlines, not one

`buildspec_1` gave a Tender a single `submission_deadline`, and the entire reminder design was built on it. The real workflow has three distinct moments: an **Internal Quote Deadline** (Assignees' supplier Quotes must be in, so the team can pick what to Bid), a **Client Submission Deadline** (our Bid must reach the client), and a client decision that arrives later on a date we do not control. They have different audiences and different failure modes, and one field cannot express any of it.

The unqualified name `submission_deadline` is what allowed one date to stand in for three, so it is renamed `client_submission_deadline`.

## Consequences

- Planned dates: `date_received`, `internal_quote_deadline`, `client_submission_deadline`. Actual: `submitted_at`, and `outcome_at` per Item.
- `submitted_at` is not redundant with `client_submission_deadline` — one is a plan, the other a fact. Once the deadline passes, a null `submitted_at` is the only thing distinguishing "submitted on time" from "never submitted", which is the failure the product exists to prevent.
- `reminders` carries a `milestone` (`internal_quote | client_submission | decision_chase`), since offsets differ per milestone.
- Clients rarely state a decision date, so **decision-chase reminders default to off** and the Owner sets one manually. That reminder anchors on an absolute `remind_on` date while all others anchor on `days_before`; the table needs both columns, exactly one populated per row.
- "Overdue" is not one condition. It is three: **Sourcing Overdue** (our problem, fixable, concerns an Assignee), **Submission Missed** (fatal, concerns the Owner), and **Awaiting Decision** (not a failure at all — the normal resting state of a live Tender). Collapsing them back into one badge would make the dashboard unable to say which one you have.

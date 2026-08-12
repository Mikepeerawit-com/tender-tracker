# No status column: Progress is derived, Outcome is stored per Item

`buildspec_1` specified a single `tenders.status` enum (`new | sourcing | quoted | won | lost | cancelled`). We split it in two and store only half. **Progress** (`new → sourcing → quoted → submitted`) is computed from the data on every read and never stored, because a hand-maintained status drifts from reality within a month and then every dashboard metric silently lies. **Outcome** (`won | lost | no_bid | cancelled`) is stored, human-set and nullable, because nothing in the data implies it — only a person knows the client's decision.

Outcome lives on `tender_items`, not on `tenders`, because clients can award part of a Tender to us and part to a competitor. A Tender's overall outcome is derived from its Items', including a `partial` value that exists only as a display state and can never be stored.

## Consequences

- **There is deliberately no `status` column.** A future reader will notice its absence and be tempted to add one. That would reintroduce exactly the drift this decision avoids.
- Progress must exclude Items marked `no_bid`, or a single unsourceable Item pins a Tender at `sourcing` forever.
- `outcome_at` sits on `tender_items` alongside `outcome`, so metrics like "won this month" have an honest column to filter on. `updated_at` is not a decision date.
- Dashboard metrics must choose a grain — Items won or Tenders won. They are different numbers and the money lives at the Item grain.

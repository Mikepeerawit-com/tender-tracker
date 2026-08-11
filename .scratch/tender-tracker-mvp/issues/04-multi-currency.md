# 04 — Multi-currency: comparison and aggregation

Type: grilling
Status: open
Blocked by: —

## Question

`buildspec_1` contains a direct contradiction. It stores `currency` per quote and explicitly refuses conversion — *"store the original currency per quote, don't force conversion at entry time"* — while simultaneously requiring:

- a comparison view with **"cheapest highlighted"**, and
- a dashboard metric **"total quoted value"**.

Neither is computable across THB, CNY, USD and whatever else suppliers quote in. You cannot highlight the cheapest of 45,000 THB and 8,900 CNY without a rate, and you certainly cannot sum them.

Decide:

1. **Is there a reporting currency?** One display currency for comparison and dashboard, with everything converted for display only. If so, which — and does that choice differ for comparison (a purchasing decision) vs the dashboard (a management view)?
2. **Where do rates come from?** A hardcoded table someone edits, a free FX API on a schedule, or manual entry per quote. Each has a failure mode; a stale rate that silently mislabels the cheapest quote is the dangerous one.
3. **Frozen or live?** Is the rate captured at quote time and stored on the quote (so history is stable and auditable), or applied at display time (so everything moves)? **This is a schema decision, not a UI one** — retrofitting a stored `rate` / `amount_in_reporting_currency` column later means backfilling with rates you no longer know.
4. **Or does something get cut?** Legitimate resolutions: "cheapest" is scoped within-currency only and the UI groups by currency; or "total quoted value" is replaced by a count, or dropped. Scope is negotiable — a metric nobody can compute honestly is worth less than no metric.

Stress-test with: two suppliers quote the same item, one in CNY and one in USD, three weeks apart, and the rate moved 4% in between. Which is cheaper, and does the answer change next month when someone reopens the tender?

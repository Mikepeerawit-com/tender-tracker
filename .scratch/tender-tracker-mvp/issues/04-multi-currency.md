# 04 — Multi-currency: comparison and aggregation

Type: grilling
Status: resolved
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

---

## Resolution

1. **Reporting Currency is THB**, used for both the comparison view and the dashboard — no split between the purchasing view and the management view. Quotes are always stored in the supplier's original currency; conversion is display-only.

2. **Rates come from [Frankfurter](https://frankfurter.dev/)**, fetched daily by the same cron that sends reminders, into an `fx_rates` table. Chosen because it is MIT-licensed, needs no API key, has no quota, and is **explicitly free for commercial use** — which matters for a vendor product. [Open Exchange Rates](https://openexchangerates.org/license) restricts its free tier to personal/small-scale/open-source use and would require a paid plan; exchangerate.host is now an APILayer commercial product with unclear free terms. Frankfurter is self-hostable if it ever disappears.
   - Caveat: Frankfurter serves **ECB reference rates — mid-market, business days only**. A quote entered on a Saturday uses Friday's rate.
   - On fetch failure, use the last known rate and flag the Quote's rate stale. Never block quote entry.

3. **Frozen at entry time.** The Quote stores `fx_rate_mid`, `fx_rate_applied` and the rate's `as_of` date. History stays stable and auditable; dashboard totals don't drift; nothing depends on a rate service at render time.

4. **A conservative buffer, not decimal rounding.** ECB mid-market is *not* what the bank charges, so the applied rate is `mid × (1 + fx_buffer_pct)`, defaulting to **2%**, erring toward overstating cost. Decimal rounding was rejected as a ~0.1% buffer that protects against nothing. Both the mid and applied rates are stored, so the buffer stays visible and can't be silently double-applied later.
   - **Outstanding input, not a blocker:** the real spread Taihue's bank charges on THB↔CNY and THB↔USD. Plug it in to replace the 2% default.

5. **"Cheapest" ranks across currencies, but never looks authoritative.** The supplier's original amount and currency is the primary number; the THB figure sits beneath it, visually secondary, labelled with its rate and date. The lowest is highlighted, not stamped "CHEAPEST". Items with a unit mismatch (ticket 01) show no ranking at all.

6. **Cost is Landed Cost, and it is entered.** Supplier prices often exclude shipping, so `cost_price` on the Tender Item is editable, pre-filled from the Selected Quote's converted THB price. `selling_price` also lives on the Tender Item — it is what we bid the client, not a property of any supplier. Margin = selling − landed cost, computed per Item, rolled up per Tender, never entered.

7. **"Total quoted value" survives** — it is computable in THB. Its grain (Items vs Tenders, all Quotes vs Selected only) is ticket 10's to settle.

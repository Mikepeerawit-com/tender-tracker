# 01 — Tender, product and quote cardinality

Type: grilling
Status: resolved
Blocked by: —

## Question

`buildspec_1` writes `tenders.product(s)` — deliberately ambiguous between one and many — while `quotes.match_type: exact | alternative` and the single nullable `quotes.alternative_product_name` presume **exactly one requested product per tender**. Both cannot be true. A tender covering five line items has no coherent answer to "is this supplier's quote exact or alternative?", and "cheapest quote" stops being well-defined the moment a quote covers a different subset of items than its neighbour.

Decide the cardinality:

- **A tender is one requested product.** A multi-item RFQ from a client becomes several tenders, possibly grouped. Keeps `quotes` exactly as specced; pushes the pain onto data entry and onto the client's view of "one RFQ."
- **A tender has line items.** Quotes attach per line item, `match_type` and `alternative_product_name` move onto the line-item quote. Models reality; adds a table and complicates every screen.
- **Something else** the real workflow demands.

Settle the vocabulary in `CONTEXT.md` while you're here — `tender`, `RFQ`, `line item`, `requested product`, `quoted product`, `alternative` are being used loosely and at least two of them mean the same thing today.

Probe with concrete scenarios: a client sends one RFQ for 3 different catheters; one supplier quotes 2 of the 3 with a substitute for the third; a second supplier quotes all 3 exactly but with a longer lead time. What does the app show, and what does "won" mean if the client buys two lines from one supplier and one from another?

This decision is upstream of the comparison view, the dashboard, search, and the storage model for photos. It is the first ticket for a reason.

---

## Resolution

**A Tender has many Tender Items; a Quote prices exactly one Item.** See [ADR-0002](../../../docs/adr/0002-tender-item-cardinality.md).

Decided on evidence: item counts per RFQ **vary by client**, so the model must carry the harder case. The rejected alternative (one Tender = one product) would have duplicated client, deadline and owner across rows, firing several independent reminder streams for a single client conversation and reporting "5 active tenders" where the business sees one opportunity.

- **No supplier-quotation parent table** in v1. A supplier pricing three Items produces three Quote rows.
- `match_type` and `alternative_product_name` live on the Quote (per-Item), so "Requested: X / Quoted: Y" is well-defined.
- **Quantity and unit** are added to the Tender Item — `buildspec_1` had no quantity field at all. Quotes carry a **unit price** plus their own `quoted_unit`; extended price is computed, never stored.
- **Unit mismatch refuses to rank.** Where a Quote's `quoted_unit` differs from its Item's `unit`, the comparison view shows "unit mismatch — compare manually" rather than silently converting. Being loudly unhelpful beats being quietly wrong.
- **Suppliers become a table** (`id, org_id, name, country`), not a typed name — per-Item Quotes mean one supplier spans many rows, and free-text names would split a supplier across columns in the comparison view.
- **Outcome is per Item, not per Tender** — clients do split awards. This cascaded into ticket 05.
- Vocabulary settled in `CONTEXT.md`: Tender, Tender Item, Quote, Bid, Alternative, Selected.

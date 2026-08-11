# 01 — Tender, product and quote cardinality

Type: grilling
Status: open
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

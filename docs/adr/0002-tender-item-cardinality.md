# A Tender has many Items; a Quote prices one Item

`buildspec_1` wrote `tenders.product(s)`, fudging whether a Tender is one product or many, while `quotes.match_type` and a single `alternative_product_name` assumed exactly one. We resolved it toward many: a **Tender** is one client RFQ with one deadline and one owner, containing one or more **Tender Items**, and a **Quote** is one supplier's price for one Item.

The decision was driven by evidence rather than preference — item counts vary by client, so the model has to carry the harder case.

## Considered Options

**One Tender = one product**, with multi-item RFQs split into several Tenders, was genuinely cheaper: it keeps `quotes` exactly as specified and adds no table. It was rejected because a 5-item RFQ would then duplicate the client, deadline and owner across five rows — firing five independent reminder streams into the WeCom group for a single client conversation, and reporting "5 active tenders" where the business sees one opportunity.

We also declined to model the supplier's *quotation document* (a parent row grouping the Items one supplier priced together). A supplier pricing three Items simply produces three Quote rows. This can be added later if quotations need to be treated as atomic all-or-nothing offers.

## Consequences

- `match_type` and `alternative_product_name` live on the Quote, which is per-Item, so "Requested: X / Quoted: Y" is well-defined.
- "Cheapest" is only meaningful per Item, never per Tender.
- Quantity and unit live on the Tender Item; Quotes carry a **unit price** plus their own `quoted_unit`. Where those units disagree, the app refuses to rank and says so, rather than silently converting and confidently highlighting the wrong supplier.
- Suppliers are a table, not a typed name — with Quotes per Item, one supplier appears on many rows and free-text names would split a single supplier across columns in the comparison view.

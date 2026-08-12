# Assignees compete on a Tender rather than dividing it

Several users are assigned to a Tender, and each sources **every** Item they can through their own suppliers. They are not splitting the work — they are competing, and comparing their Quotes is the entire point. Assignment is therefore many-to-many at the **Tender** level (a join table), never per-Item.

Only an Assignee may enter Quotes on a Tender, because the Assignee is the person who actually spoke to the supplier and anyone entering on their behalf destroys attribution. Any user may add themselves to any Tender; the Owner may add or remove anyone.

## Consequences

- **There is deliberately no unique constraint on `(tender_item_id, supplier_id)`.** Two Assignees contacting the same supplier and getting different prices is expected and informative — it reveals that the negotiating position varies by who calls. A future reader will see the duplicate rows and want to add a unique index. That would delete the most interesting signal in the dataset and prevent the second caller from recording their work at all. The comparison view surfaces the duplication instead of hiding it.
- `quotes.created_by_user_id` is load-bearing, not audit trim: with several Assignees quoting the same Item, it is the only thing identifying whose Quote won.
- The "only Assignees may quote" rule is trivially bypassable by self-assigning, and that is intended. It is not a security control — everyone is trusted and all users see all financial data. It is a deliberate step that enrols you in the Tender's reminders and digests before you start work.
- Assignees may legitimately fail to source an Item, so sourcing reminders cannot demand full coverage. An Assignee records **No Supplier Found** to silence the nag, which also captures information the app would otherwise lose: "nobody could supply this" and "nobody tried" mean opposite things when deciding whether to Bid.
- When an Item is decided, every Assignee who quoted it is notified — not only the winner. They all competed; the losers' only feedback on how their supplier compared comes from this message.

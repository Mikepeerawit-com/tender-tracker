# 09 — Quote comparison view

Type: prototype
Status: open
Blocked by: 01, 04

## Question

This is the screen the app exists for — everything else is data entry around it — and "side-by-side supplier quotes, cheapest highlighted" is not enough to build from. Raise the fidelity by making a cheap, throwaway artifact to react to. Use `/prototype`.

Build it against the settled cardinality (01) and the settled currency decision (04) — both change the shape of this screen fundamentally, which is why this ticket waits on them.

**Questions to answer by building, not by discussing:**

1. **Does side-by-side survive reality?** It reads well with 3 suppliers and collapses at 8. Prototype both. A dense table may beat cards; find out before committing.
2. **Where does "Requested: X vs Quoted: Y" live?** `buildspec_1` is emphatic that alternative-product quotes must not bury the substitute in notes. Make it impossible to miss that a supplier quoted something different — and check it still reads clearly when *most* quotes are alternatives.
3. **Mixed currencies, honestly.** Per 04's decision, show what "cheapest" means without lying. If rates are involved, the UI must make the converted number visibly derived, not authoritative.
4. **Selection and pricing.** Marking a quote selected, then entering cost and selling price with margin computed live. Where does that live — inline on the selected quote, or a separate step? Margin is never entered, only shown.
5. **Photos without domination.** Multiple images per quote, several quotes on screen. Thumbnails, a lightbox, a count badge?

**Output:** the prototype, linked from this ticket (not pasted in), plus the decisions it settled. The prototype is throwaway — its value is the argument it settles, not the code.

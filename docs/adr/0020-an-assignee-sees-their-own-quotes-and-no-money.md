# An Assignee sees their own Quotes and no money

**Status:** accepted. Reverses the flat-visibility posture stated in `CONTEXT.md` under **Org Admin** and assumed by the v1 RLS policies; supersedes nothing.

Until now every signed-in user saw the same `/tenders/[id]`: the comparison sheet, every Assignee's Quotes ranked against each other, Landed Cost, Selling price, Margin and Coverage. That was not a decision anybody took — it fell out of "one policy per table, inside your org you read everything", which was the right call when the only question was org isolation. Read as a *screen* rather than as a policy, it is wrong on two counts.

**The decision: on a Tender they are an Assignee but not the Owner of, a user sees their own Quotes and no others, and sees no money figure at all.** The comparison sheet, Landed Cost, Selling price, Margin and Coverage belong to the Owner. What the Assignee keeps is the whole of their own job: the Tender's facts and deadlines, its Items, the Reference Images, their own Quotes and photos, and the ability to record No Supplier Found.

## Why

**`CONTEXT.md` already assumed this and the screen contradicted it.** **Assignee** says Assignees *"compete rather than divide, because comparing their Quotes is the point"* — comparing is what the Owner does with them, not something the competitors do to each other. **Outcome News** is defined as *"the losers' only feedback anywhere in this app on how their supplier compared"*. That sentence is only true if an Assignee cannot already open the sheet and read the comparison directly, which they could. One of the two had to move, and the glossary is the considered one.

**It is also the largest simplification available.** On a four-item Tender with three Quotes apiece the detail screen carries 50+ interactive controls, and the overwhelming majority of them are the sheet — a nine-column ranked table, per-quote Select buttons, two inline auto-saving money inputs per Item, and the Outcome panel. None of it is an Assignee's work. Halving that screen for the people least equipped to read it is worth more than any amount of restyling, and it is the reason this ADR exists rather than being a security footnote.

**Margin was already declared internal-only.** This ADR only settles what "internal" means: the Owner, not the org.

## What it costs

**An Assignee can no longer see that they have been undercut.** That is a real commercial loss — someone who can see a rival supplier came in lower has a reason to go back and sharpen their price, and they lose it. It is accepted deliberately, on the grounds that the feedback still arrives through **Outcome News** once the client rules, and that a sourcing race where everyone watches everyone else's prices in real time is not the race this business is running.

**The Owner's screen does not change.** All of this is about a viewer who is not the Owner; the Owner sees exactly what they saw.

## Consequences

- **This is the first visibility tier in the app.** `CONTEXT.md` is emphatic that an Org Admin *"has no extra visibility"*, and that stays true — the tier is Owner-vs-Assignee on one Tender, not a rank in the organisation. Anyone adding a second tier should have to argue for it here.
- **RLS is not where this is enforced, and that is deliberate.** Org isolation stays exactly as it is. This is a per-Tender viewer distinction inside a single org, so it belongs in the query layer that builds the screen, where the Owner check already lives (`mayCorrectQuote` is the existing precedent). Pushing it into policies would mean an Owner and an Assignee needing different policies on the same rows, which is how a fail-closed model turns into a maze.
- **Every screen-shaping query needs the viewer.** The tender-detail loader currently answers the same shape for everybody; it now takes "am I the Owner" as an input, and the tests need a non-Owner Assignee fixture that does not exist today.
- **Outcome News becomes load-bearing rather than nice.** It is now genuinely the only feedback a losing Assignee ever gets. Anything that silences or delays it is a bigger change than it looks.

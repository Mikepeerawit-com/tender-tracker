# Tender Tracker

Tracks client tenders/RFQs at a medical-supplies trading company: what a client asked
for, what suppliers quoted in response, what we bid back, and whether we won.

## Language

### The client side

**Tender**:
One request from one client, with one deadline and one owner. The unit a client
would recognise as "the enquiry they sent us".
_Avoid_: RFQ, enquiry, bid request

**Tender Item**:
One distinct product a Tender asks for. A Tender always has at least one; multi-item
Tenders are normal and the model carries them natively.
_Avoid_: line item, product, requested product, SKU

**Bid**:
What we submit back to the client — our offer, derived from the Quotes we selected.
Distinct from a Quote, which points the other way.
_Avoid_: our quote, submission, proposal

**Reference Image**:
A picture the *client* supplied showing what a Tender Item is asking for. Attached to
the Tender Item, not the Tender, so it sits beside the Quote Photos it is meant to be
compared against. Points the opposite way to a Quote Photo and is never called a photo.
_Avoid_: photo, client photo, RFQ image, attachment

### The supplier side

**Quote**:
One supplier's price for one Tender Item. A supplier who prices three items produces
three Quotes; a supplier who can only price two produces two.
_Avoid_: supplier quote, quotation, offer

**No Supplier Found**:
An Assignee's explicit record that they could not source a Tender Item. Silences the
sourcing nag for them and distinguishes "nobody could supply this" from "nobody tried"
— which mean opposite things when deciding whether to Bid at all.
_Avoid_: skipped, unavailable, N/A

**Alternative**:
A Quote where the supplier priced a different product from the one the Tender Item
asked for. Carries the substitute's own name — never buried in notes.
_Avoid_: substitute, equivalent, non-exact

**Quote Photo**:
A picture the *supplier* supplied showing what they can actually provide, attached to
the Quote. Load-bearing rather than decorative: on an Alternative it is often the only
way to judge how far the substitute really is from what was asked for.
_Avoid_: photo, image, supplier image, attachment

**Not Yet Sourced**:
A Tender Item an Assignee has neither Quoted nor marked No Supplier Found. The third
sourcing state, and the only one that is overdue: an Item nobody has touched means
different work from one somebody has already given up on.
_Avoid_: no quote, missing, blank

**Assignee**:
A user working a Tender. Several Assignees work the same Tender at once, each
sourcing every Item they can through their own suppliers — they compete rather than
divide, because comparing their Quotes is the point. Only an Assignee may enter
Quotes on that Tender, since they are the one who actually asked the supplier.
_Avoid_: sourcer, responsible person, assigned user

**Owner**:
The user who created a Tender. Accountable for the client relationship and for the Bid
going out on time; receives submission and decision reminders. Usually also an
Assignee. A role, not a rank — every user can create Tenders and be an Assignee.
_Avoid_: manager, admin, lead

**Selected**:
The Quote we chose to build our Bid from, per Tender Item. Different Tender Items on
the same Tender may be Selected from different suppliers.
_Avoid_: chosen, winning quote, accepted

### State

**Progress**:
Where a Tender has got to, derived entirely from its data — never stored, never
hand-maintained. Runs `new` → `sourcing` → `quoted` → `submitted`.
_Avoid_: status, stage, state

**Outcome**:
How a **Tender Item** ended: `won`, `lost`, `no_bid` (we chose not to bid), or
`cancelled` (the client pulled it). Human-set and stored per Item, because clients
can award part of a Tender to us and part to a competitor. Null until decided.
A Tender's overall outcome is derived from its Items' Outcomes, never stored.
_Avoid_: status, result, final status

**Internal Quote Deadline**:
When Assignees must have their suppliers' Quotes in, so the team can pick what to Bid.
Set per Tender. Ours to enforce.
_Avoid_: deadline, quote deadline

**Client Submission Deadline**:
When our Bid must reach the client. Missing it kills the Tender outright.
_Avoid_: deadline, submission deadline

**Sourcing Overdue**:
The Internal Quote Deadline has passed and some Assignee's Item still has no Quote.
Derived, never stored. Still fixable; concerns that Assignee alone.
_Avoid_: late, overdue

**Submission Missed**:
The Client Submission Deadline has passed with nothing submitted. Derived, never
stored. The Tender is dead — this is the failure the product exists to prevent.
_Avoid_: expired, lapsed, overdue

**Awaiting Decision**:
Submitted, with Outcomes still unrecorded. Not a failure — the normal resting state of
a live Tender, and a prompt to chase the client.
_Avoid_: pending, open, in progress

**Digest**:
The once-daily post to the WeCom group listing every open Tender and its next
milestone. Answers "what is going on right now"; distinct from a reminder, which fires
only when a specific deadline approaches.
_Avoid_: summary, daily report, standup

### Money

**Reporting Currency**:
Thai Baht (THB). The single currency comparison and dashboard figures are displayed
in. Quotes are always stored in the currency the supplier quoted; conversion is for
display only and is always shown as derived.
_Avoid_: base currency, home currency, display currency

**Landed Cost**:
What a Tender Item actually costs us — the Selected Quote's price converted to THB,
plus shipping, duty and handling. Pre-filled from the Quote, then edited, because
supplier prices often exclude freight.
_Avoid_: cost, cost price, ex-works price

**Unconfirmed**:
A Landed Cost still sitting at its pre-filled value, which nobody has yet added shipping,
duty or handling to. Any Margin derived from one is understated in cost and overstated in
profit, so it is shown as provisional rather than as a number. Nothing is blocked and
nobody is nagged — the figure simply does not pretend to be final.
_Avoid_: unedited, draft, estimated, incomplete

**Margin**:
Selling price minus Landed Cost, on a Tender Item. Always computed, never entered.
Internal-only.

**Bids Out**:
The money still riding on Bids the client has not ruled on — selling price × quantity
across Tender Items with no Outcome, on submitted Tenders. An Item already won is
money banked, not money at stake, and drops out. Replaces the deleted "total quoted
value", which summed competing Quotes for the same goods and so overstated by ~7×.
_Avoid_: pipeline, total quoted value, open value

### Identity

**Org Admin**:
The single user who may invite others into the organisation. A capability, not a rank —
an Org Admin has no extra visibility and no say over Tenders they don't own. Stored as
a boolean, true for exactly one row, deliberately not a role enum.
_Avoid_: admin, owner, superuser, manager

**Invite**:
The email an Org Admin sends to bring a new user into the organisation. The only way an
account comes into existence, and the only email the app sends. Scanning a WeCom QR code
never creates an account.
_Avoid_: signup, registration, onboarding link

**Connected WeCom**:
A user who has linked their WeCom identity to their existing account, and may thereafter
log in by scanning instead of typing a password. Linking happens once, while already
signed in — never inferred at login. A user who is not Connected loses nothing but
convenience.
_Avoid_: WeCom user, linked account, SSO user

**Disabled**:
A user whose access has been revoked but whose row remains, because they own Tenders and
entered Quotes that must stay readable. Users are never deleted. Disabling is a manual
step — nothing checks WeCom membership automatically.
_Avoid_: deleted, removed, deactivated, archived user

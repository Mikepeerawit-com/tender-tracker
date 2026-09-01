# Tender Tracker

Tracks client tenders/RFQs at a medical-supplies trading company: what a client asked
for, what suppliers quoted in response, what we bid back, and whether we won.

## Language

The terms below are the **domain** model: what we call things in conversation, in code,
in tests and in ADRs. They are not automatically what the screen says. Where a term is
jargon to a supplier-chaser on a phone, a `_Label_` line records the words the interface
uses instead, per language. The domain term never bends to fit the button; the button is
free to say something a new colleague understands on first read.

A term with no `_Label_` line is shown as it is written.

### The client side

**Tender**:
One request from one client, with one deadline and one owner. The unit a client
would recognise as "the enquiry they sent us".
_Label_: en "Tender" · zh 招标 — never 标书, which is the bid *document* and points the
other way.
_Avoid_: RFQ, enquiry, bid request

**Tender Item**:
One distinct product a Tender asks for. A Tender always has at least one; multi-item
Tenders are normal and the model carries them natively.
_Label_: en "Item" · zh 产品项 — one word, everywhere. 招标明细, 条目 and bare 产品 are
three more names for this and are not used.
_Avoid_: line item, product, requested product, SKU

**Bid**:
What we submit back to the client — our offer, derived from the Quotes we selected.
Distinct from a Quote, which points the other way.
_Avoid_: our quote, submission, proposal

**Reference Image**:
A picture the *client* supplied showing what a Tender Item is asking for. It belongs on
the Tender Item, so that it sits beside the Quote Photos it is meant to be compared
against. Points the opposite way to a Quote Photo and is never called a photo.
_Avoid_: photo, client photo, RFQ image, attachment

**Unassigned**:
A Reference Image that has arrived on a Tender but has not yet been said to be of any one
Tender Item. The state every Reference Image starts in, and a finished one rather than a
half-written one: they arrive as a single email carrying five pictures, with nothing in it
saying which Item each is about, so the upload is per-Tender and the assignment is a
separate act afterwards. Shown on the Tender rather than hidden until somebody places it,
because the ones nobody has placed are the ones with work outstanding on them.
_Avoid_: orphan, pending, untagged, unlinked

### The supplier side

**Quote**:
One supplier's price for one Tender Item. A supplier who prices three items produces
three Quotes; a supplier who can only price two produces two.
_Avoid_: supplier quote, quotation, offer

**No Supplier Found**:
An Assignee's explicit record that they could not source a Tender Item. Silences the
sourcing nag for them and distinguishes "nobody could supply this" from "nobody tried"
— which mean opposite things when deciding whether to Bid at all.
_Label_: stated in the first person, as something the Assignee did rather than a status
they set — "I could not source this" / "I found one after all".
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

It has a screen of its own: **My work** lists exactly the Items an Assignee is Not Yet
Sourced on, and nothing else. The list is finishable — marking No Supplier Found removes
a row just as entering a Quote does, because both are answers and only silence is not.
_Label_: the screen is "My work"; a row is never headed "pending".
_Avoid_: no quote, missing, blank, pending

**Assignee**:
A user working a Tender. Several Assignees work the same Tender at once, each
sourcing every Item they can through their own suppliers — they compete rather than
divide, because comparing their Quotes is the point. Only an Assignee may enter
Quotes on that Tender, since they are the one who actually asked the supplier.

An Assignee sees their own Quotes and no one else's, and sees no money at all
(ADR-0020). Comparing is the Owner's act, not theirs.
_Label_: en "Assignee" · zh 参与人 — never 负责人, which is the Owner.
_Avoid_: sourcer, responsible person, assigned user

**Owner**:
The user who created a Tender. Accountable for the client relationship and for the Bid
going out on time; receives submission and decision reminders. Usually also an
Assignee. A role, not a rank — every user can create Tenders and be an Assignee.
_Label_: en "Owner" · zh 负责人 — held for this term alone.
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
_Label_: named by who it is waiting on rather than by its own condition — "Waiting on
you".
_Avoid_: late, overdue

**Submission Missed**:
The Client Submission Deadline has passed with nothing submitted. Derived, never
stored. The Tender is dead — this is the failure the product exists to prevent.

The *state* is derived on every read, and the *announcement* is a Reminder like any
other: one row, dated the day after the deadline, because a deadline has not been missed
until it has passed. That is what makes it said once rather than every morning after,
and what makes a client's extension re-arm it (ADR-0015).
_Avoid_: expired, lapsed, overdue

**Awaiting Decision**:
Submitted, with Outcomes still unrecorded. Not a failure — the normal resting state of
a live Tender, and a prompt to chase the client.
_Avoid_: pending, open, in progress

**Decision Chase**:
The Owner's own reminder to go and ask the client how it went, on a day they name
outright. Off unless set, because clients rarely state when they will decide and there is
no honest day to guess. The only Milestone with no offset, and the only one silenced by a
Tender *not* having been submitted — there is no decision coming on a Bid that never went.
_Avoid_: follow-up, chase-up reminder, decision reminder

**Outcome News**:
The group post that follows an Item being recorded `won` or `lost`. It reaches **every
Assignee who quoted that Item**, not only the one whose Quote we bid, and says a different
thing to each: the losers' only feedback anywhere in this app on how their supplier
compared comes from this message. `no_bid` and `cancelled` are silent — neither is a
verdict on anybody's sourcing. The one message that fires on a write rather than on the
cron (ADR-0015).
_Avoid_: outcome notification, result announcement, win notification

**Group Robot**:
The WeCom webhook every notification leaves through — one URL, posting into one group
chat. The only WeCom surface this project is not gated out of, and the only outbound
integration in v1. What it says is deliberately narrow: never a price, a Margin or a
supplier's name (ADR-0012).
_Label_: zh 群机器人 is WeCom's own name for the feature and lands instantly; the English
calque does not, so en says "WeCom group". The one English sentence that keeps "robot" is
the one walking somebody through WeCom's own interface to find the webhook: a wayfinding
instruction has to use the name the feature carries on the screen it is sending them to.
_Avoid_: bot, webhook, notifier, WeCom integration

**Reminder**:
A nudge into the WeCom group that a Tender's deadline is coming. One stored row per
Milestone per offset, carrying the day it comes due — so a run the cron missed catches
up rather than skipping, and moving the deadline re-dates the whole set. Fires at
thresholds only; the Digest is what answers "what is going on right now".
_Avoid_: notification, alert, nag, ping

**Milestone**:
The dated thing a Reminder is counted from. Four of them: the Internal Quote Deadline,
the Client Submission Deadline, the Submission Missed announcement, and the Owner's own
decision-chase date. Which Milestone a Reminder is for decides three things — who it @s,
what its line says, and what makes it stop being worth posting. The Internal Quote
Deadline reaches only Assignees who have entered no Quotes at all; the other three reach
the Owner. Three count *back* from a date the Tender already holds; the decision chase has
no offset at all and fires on the absolute day the Owner set.
_Avoid_: event, trigger, deadline type

**Digest**:
The once-daily post to the WeCom group listing every open Tender and its next
Milestone. Answers "what is going on right now"; distinct from a Reminder, which fires
only when a specific deadline approaches. Open means what the tender list means by it:
no Outcome recorded yet. It **@s nobody** — a daily mention is how a group learns to mute
the robot it also hears the Reminders through — and it is **silent on a morning with
nothing open**, because a daily message with no work in it is the same lesson by a
slower route. It is stateless: nothing records that one went out, and a Digest missed is
answered by tomorrow's rather than caught up.
_Label_: en "daily summary" · zh 每日摘要. "Digest" is ours; a capitalised proper noun
for a thing the reader has no screen for is the worst string in the app.
_Avoid_: summary, daily report, standup

### Money

**Reporting Currency**:
Thai Baht (THB). The single currency comparison and dashboard figures are displayed
in. Quotes are always stored in the currency the supplier quoted; conversion is for
display only and is always shown as derived.
_Avoid_: base currency, home currency, display currency

**Frozen Rate**:
The pair of exchange rates a Quote stores at the moment it is entered — ECB mid-market
and the buffered rate actually applied — together with the day ECB published them. Never
re-fetched by a clock, a cron or a backfill, so a ranking somebody saw is reproducible
from the row a year later and no dashboard total moves because a currency did. Both are
kept so the buffer stays visible and cannot be applied twice. A THB Quote's are both 1
and it is not converted at all.

The one thing that re-freezes it is a human correcting the day the Quote *claims*: the
rate has always belonged to the quoted date rather than to the day somebody typed it in,
so a corrected `quoted_at` gets the rate for the new date and a corrected price keeps the
rate it had (ADR-0018).
_Avoid_: exchange rate, fx rate, conversion rate

**Stale Rate**:
A Frozen Rate taken from the last one this app stored, because the rate service could not
be reached. Recorded rather than refused: an Assignee holding a price the supplier just
gave them must never be stopped by a service in Frankfurt. It is shown as stale wherever
the converted figure is, because two Quotes frozen on different days can differ by more
than the gap the comparison is claiming to show.
_Avoid_: old rate, cached rate, fallback rate

**Landed Cost**:
What a Tender Item actually costs us — the Selected Quote's price converted to THB,
plus shipping, duty and handling. Pre-filled from the Quote, then edited, because
supplier prices often exclude freight.
_Label_: en "Cost to us" · zh 到岸成本, which is the ordinary trade term and needs no
softening.
_Avoid_: cost, cost price, ex-works price

**Unconfirmed**:
A Landed Cost still sitting at its pre-filled value, which nobody has yet added shipping,
duty or handling to. Any Margin derived from one is understated in cost and overstated in
profit, so it is shown as provisional rather than as a number. Nothing is blocked and
nobody is nagged — the figure simply does not pretend to be final. Writing the figure by
hand is what confirms it: touched and vouched-for are one fact, not two (ADR-0014).
_Label_: **"Provisional"**, one word, everywhere it appears — it says what the figure is
rather than what somebody failed to do. The app shipped two labels for this one state,
"Unconfirmed" and "Provisional"; the second wins and the first leaves the interface.
_Avoid_: unedited, draft, estimated, incomplete, unconfirmed *as a label*

**Margin**:
Selling price minus Landed Cost, on a Tender Item. Always computed, never entered.
Internal-only — and internal now means the Owner, not the org (ADR-0020).
_Label_: en "Profit" · zh 毛利.

**Coverage**:
How many Tender Items carry a selling price, out of all of them. Sits at the head of the
working sheet's totals bar because the three money figures beside it mean nothing without
it: a Bid total across two of four Items must not be read as the Tender's.
_Avoid_: completeness, progress, fill rate

**Bids Out**:
The money still riding on Bids the client has not ruled on — selling price × quantity
across Tender Items with no Outcome, on submitted Tenders. An Item already won is
money banked, not money at stake, and drops out. Replaces the deleted "total quoted
value", which summed competing Quotes for the same goods and so overstated by ~7×.
_Avoid_: pipeline, total quoted value, open value

### Identity

**Org Admin**:
A user who may invite others into one organisation. A capability, not a rank — an Org
Admin has no extra visibility and no say over Tenders they don't own. Still a boolean and
deliberately not a role enum, but it is a property of a **Membership** rather than of a
person: admin of one organisation says nothing about any other. An organisation must
always have at least one, so the last one cannot be Disabled (ADR-0017).
_Label_: en "Administrator" · zh 组织管理员.
_Avoid_: admin, owner, superuser, manager

**Invite**:
The email an Org Admin sends to bring someone into *their* organisation. The only way a
Membership of an existing organisation is ever created, and the only email the app sends.
Scanning a WeCom QR code never creates an account. Signing up creates a new, empty
organisation and never joins an existing one — so no stranger can put themselves inside
another org's prices (ADR-0017). An Invite grants Membership only; becoming an Org Admin
is a separate deliberate act by an existing one.
_Avoid_: signup, registration, onboarding link, join request

**Connected WeCom**:
A user who has linked their WeCom identity to their existing account, and may thereafter
log in by scanning instead of typing a password. Linking happens once, while already
signed in — never inferred at login. A user who is not Connected loses nothing but
convenience.
_Avoid_: WeCom user, linked account, SSO user

**Test Mention**:
A message an Org Admin posts to the group @ing one colleague, to find out whether their
`wecom_userid` actually reaches them. The only verification that exists: WeCom accepts a
wrong userid without complaint, so a colleague replying is the sole evidence. Done once
per person, by hand.
_Avoid_: test message, ping, verification, delivery check

**Disabled**:
A user whose access has been revoked but whose row remains, because they own Tenders and
entered Quotes that must stay readable. Users are never deleted. Disabling is a manual
step — nothing checks WeCom membership automatically. An organisation's last Org Admin
cannot be Disabled, because nobody could then ever invite anyone into it again.
_Avoid_: deleted, removed, deactivated, archived user

**Membership**:
One person's place in one organisation, and where their Org Admin capability lives. A
person may hold several. It is the Membership rather than the person that an Invite
creates, that Disabling ends, and that RLS reads — which is why admin of one organisation
grants nothing anywhere else.
_Avoid_: role, org user, user_org, seat

**Active Org**:
The one organisation a session is currently looking at. Everything on every screen is
scoped to it, and a person holding several Memberships changes it deliberately rather
than seeing two organisations' Tenders in one list. The control that changes it does not
render at all for the overwhelming majority who hold exactly one Membership — a global
mode is worth its cost only to the people who actually have a second thing to switch to.
_Avoid_: current org, selected org, workspace, tenant

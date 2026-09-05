# The tender list is reduced before it is read, and the filter is a link

> **Amends [ADR-0007](0007-dashboard-is-an-action-board.md).** That decision's structure
> holds entirely — the screen answers "what do I do next", there are still no metric cards,
> Submission Missed is still pinned, and every Tender still appears in exactly one place.
> What this amends is the **volume** ADR-0007 reasoned against, and one of its consequences.

ADR-0007 argued twice from a number: *"counting is not worth a card at this volume"*, and
*"ten Tenders across four columns is two cards a column"*. Both were right answers to the
question as it stood, and both are answers to a question that has changed. The business now
runs **around fifty live Tenders at once**, with an archive behind them that only grows.

Fifty grouped rows is a long scroll on a 390px phone, and the one a reader wants is rarely
near the top. `listWorklist` read the whole table and drew every row, which was the correct
shape for six and is not the correct shape for fifty. **The list is now reduced before it is
read**: a search field, four built-in Views, and Progress and Mine filters underneath.

## What the volume figure buys, and what it does not

Fifty is small, and saying so removes more work than it adds. **There is no pagination, no
virtualization and no search index**, and none should be added on the strength of this ADR.
"My work" in particular must never truncate — it is finishable by design, so it caps by
filtering or not at all.

**The filter is not SQL.** Progress and the three sourcing states are derived on every read
([ADR-0001](0001-derived-progress-stored-outcome.md)) and stored nowhere, so a `where`
clause on either would mean writing that arithmetic a second time, in another language,
where the first copy's tests cannot see it. At fifty rows the whole list is already in hand
when the filter runs, so the filter is a **predicate over rows**. If the live count ever
reaches a thousand, `worklist-filter.ts` is the wrong shape and should be replaced rather
than extended — that is the trigger to come back here.

## Every control is a link

The whole filter lives in `searchParams` and the screen holds no state of its own. Three
reasons, and the third is the one that decided it:

- A narrowed list is a **link a colleague can be sent** — the same reasoning that keeps the
  list at `/tenders` rather than `/`, and that keeps locale out of the URL
  ([ADR-0011](0011-locale-is-not-in-the-url.md)).
- Back goes where a reader expects, because narrowing a list is a navigation.
- **Nothing needs hydration.** The slowest path in the product is a Group Robot link opened
  at night inside the WeCom webview over a phone network
  ([ADR-0024](0024-the-theme-is-the-readers-not-the-devices.md)), and a filter bar that does
  not work until JavaScript arrives is a filter bar that does not work there. The search
  field is a plain `GET` form for the same reason.

One consequence is worth stating because it caught a test suite: a `GET` form is a
navigation and not a write, so `pending.layout.test.tsx` — which presses every submit in
the shared records to prove a working control says so — excludes `form[method="get"]`.
Server Actions compose as `POST` and are untouched.

## Views are built in, not saved

Four of them: **Mine**, **Not Yet Sourced**, **Submitted**, **Everything**. They are
constants, identical for everybody, and each is nothing more than a filter the module can
already express.

A saved view — a row somebody creates, names, shares and eventually deletes — was rejected.
At fifty live Tenders across a team under ten it is a management screen bolted onto a
worklist to solve a problem nobody has. What a reader wants is the three or four questions
they ask every morning, already answered.

**Mine is the landing state, and Everything is one deliberate tap away.** With ten Tenders
everybody read the whole list and a default was not a decision. With fifty, most rows are
somebody else's work, and a screen whose first answer to *what do I do next* is two hundred
rows of other people's Tenders has answered a different question. The whole org stays
reachable — it is a View like any other — but it is never what the reader lands on.

This costs one thing and it is worth naming: an unparameterised `/tenders` is therefore
already filtered, so the reader must be able to see that it is. The bar states the View it
applied rather than leaving a short list unexplained, and the count it draws is drawn on
arrival rather than only once somebody touches a control.

It also inverts one URL key. **Mine is the absence of a parameter and Everything is
`?mine=0`** — the only key written for being *off*. The alternative, a `?mine=1` that the
landing state writes for itself, would mean either a redirect on every bare `/tenders` or
two spellings of one list, and a link is the thing this whole design asks people to share.

**The Digest link is `?mine=0` and must stay that way.** It is the one URL in the product
read by people who did not build it: the daily run posts a single message to a group and
every reader taps the same link. Left as a bare `/tenders` it would resolve to each
reader's own subset of a count the message states for the whole org — a colleague who owns
none of the listed Tenders taps *12 tenders need attention* and lands on an empty list.
`app-links.ts` builds it from this module's own `Everything` constant rather than from a
literal, so the key cannot drift out from under a message nobody can edit.

The Views and the individual controls are **two grains of one taxonomy, never two
vocabularies**. Which View is lit is computed by comparing filters by value, so a reader who
assembles a View's filter control by control sees that View light up: the screen says what
is true of the list, never which route the reader took to it. ADR-0007's 29 August 2026
amendment is why this matters — the five blocks it replaced were two taxonomies wearing one
set of headings, and readers felt that as the screen being hard to learn.

## The consequence that changes ADR-0007

**Submission Missed is filtered like everything else, and the screen states the cost.**

ADR-0007 pins Submission Missed above the groups because it is *"the failure the product
exists to prevent"*, and the first draft of this work kept it exempt from filtering
altogether. That did not survive: a reader who asks for **Mine** and gets a colleague's
Tenders back has been told their filter does not mean what it says, and once one control
lies the rest cannot be trusted either.

So the filter applies uniformly, and where it hides a missed submission the screen says so —
how many, in the alarm tone, with a control that reveals them. ADR-0007's claim is honoured
in the only way that leaves the controls honest: the failure is never buried **silently**.

The reveal control **relaxes only what suppressed those rows** and keeps the rest of the
reader's filter. A control that dropped their search text and Progress selection on the way
would be a second Clear wearing a different label.

That is a separate key rather than a computed step back — `?missed=1`, which exempts the
one pinned group and touches nothing else. Relaxing the narrowing axes instead was tried
and is not equivalent: it reveals *at least* what was counted rather than exactly it, and
it is a dead link in the case where what hid the rows was the reader's search text. Being
the one widening in the filter, it is excluded from *is this list filtered* and from the
comparison that lights a View — a reader who reveals the missed submissions has not left
the View they were reading.

## What the design pass confirmed rather than changed

The redesign was run through design tooling, and the useful output was a confirmation. Asked
as a generic SaaS product it proposed a marketing hero and **Glassmorphism**, both rejected:
`backdrop-filter` is an unbudgeted repaint in the WeCom Android webview, and frosted glass
behind Han glyphs loses the stroke contrast a CJK reader needs at 14px. Asked as a dense
dashboard it proposed Swiss minimalism and **Fira Sans / Fira Code** — which is what
[ADR-0019](0019-the-visual-system-is-built-for-a-chinese-reader-on-a-phone.md) already
specifies.

**No new colour tokens were added.** Three were proposed — a quiet wash for furniture, a
staleness ramp, a marker for "assigned to you" — and all three were dropped as already
expressible: `--muted`, and `--signal`, which is already licensed to say *something is
expected of you*. The staleness ramp is the one worth recording as rejected, because it will
be proposed again: it sounds distinct from Alarm, but every Tender carries an Internal Quote
Deadline, and that date plus Not Yet Sourced already catches a Tender nobody has priced.
There is no untouched-but-not-yet-due gap wide enough to justify a fourth hue.

A generated design-system file briefly lived at `design-system/tender-tracker/MASTER.md`,
claiming authority over this repo's own documents. It was deleted rather than trimmed: this
repo is single-context, one glossary and one ADR directory at the root, and a second file
telling a reader to "strictly follow the rules below" is a fork in the standards no matter
how good its contents are. What was worth keeping from it is the two paragraphs above.

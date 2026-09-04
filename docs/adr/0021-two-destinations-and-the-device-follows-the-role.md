# Two destinations, and the device follows the role

**Status:** accepted. Extends [ADR-0007](0007-dashboard-is-an-action-board.md) with a second list; qualifies [ADR-0009](0009-comparison-sheet-reflows-at-768px.md)'s claim that reflow removes the need for a separate design.

> **Partly superseded by [ADR-0022](0022-one-region-one-left-edge.md), 4 September 2026.** The per-screen committed widths settled by the amendment at the foot of this file are gone: every screen behind the login now draws in one region at 1280px, and what varies per screen is the measure inside it. Everything else here stands — two destinations, the bottom bar below `md`, and the device following the role. ADR-0022 records why per-screen widths were the right answer in #97 and the wrong one now.

The app has had no navigation at all: one app bar, and a hamburger holding a single item for a non-admin (Sign out). Everything is reached by drilling from `/tenders`. That is a defensible shape for one list, and it produced one bad outcome — **an Assignee's actual job is buried three levels down**. To enter a price they open the worklist, pick a Tender, find their Item among the others, and open it. The reminder that summoned them names an Item; the app makes them navigate a Tender.

## The decision

**Two destinations, in a bottom bar below `md` and in the top app bar above it.**

- **My work** — the Tender **Items** this user is an Assignee on and is **Not Yet Sourced** on. Each row links straight to the quote form. Nothing else is on it.
- **Tenders** — the existing worklist from ADR-0007, grouped by Progress, unchanged.

**And the grain is the point.** ADR-0007's list answers "which Tender needs me", which is an Owner's question. An Assignee's question is "which Items do I still owe a price on", and no filter on a list of Tenders answers it, because filtering Tenders yields Tenders. The second destination exists because the *unit* is different, not because the first one was too long.

**My work is deliberately finishable.** It holds only **Not Yet Sourced** Items, so marking No Supplier Found empties a row exactly as entering a Quote does — both are answers, and only silence is not. Showing already-quoted Items so they could be revisited was rejected: a list that never reaches zero stops being work-to-do and becomes another thing to scan, which is the disease. Correcting a Quote is a rare act and keeps its existing route through the Tender.

## The device follows the role

ADR-0009 held that reflow means *"login, the tender list, add/edit tender and add-quote need no separate phone design"*. In practice the inverse happened: those screens got no separate **desktop** design either. Six of eight screens are a 768px column at every viewport, 67% of all breakpoint utilities in the repo live in `working-sheet.tsx`, and no `xl:` or `2xl:` rule exists anywhere. On a 1440px monitor the app is a centred phone with a full-bleed header disagreeing about where the page edge is.

**So each destination is designed for the device its role actually uses.** *My work* and the quote form are designed at 390px — that is an Assignee tapping a Group Robot link into the WeCom webview, one-handed, and it is the case ADR-0019's whole type and colour system was built for. *Tenders* and the tender detail are designed at 1280px — that is an Owner at a desk comparing nine columns of Quotes and typing prices, and `working-sheet.tsx` is already the one genuinely desktop-composed component in the app. **Neither has to pretend to be good at the other**, and this is the same split as [ADR-0020](0020-an-assignee-sees-their-own-quotes-and-no-money.md): the role split and the device split are one split seen twice.

Login, set-password and choose-language stay a narrow centred column at every width, which is correct for them forever.

## What was rejected

- **A third destination for "Record a tender".** It is an Owner action, already one tap from the sparsest screen in the app, and a bar item most users must never press is a bar item teaching them to ignore the bar.
- **A "Mine / All" filter instead of a second destination.** It does not change the grain, so it does not fix the burial.
- **Top tabs at every width.** One implementation instead of two, but on a phone it competes with the thumb and with WeCom's own webview chrome at the top of the screen.
- **A desktop sidebar.** A container built for ten items holding two, spending ~240px to say what a pair of tabs says in 120.

## Consequences

- **Two nav implementations must stay in sync**, which is the honest cost of the bottom-bar/top-bar split and the reason the set is capped at two items. A third destination should be treated as a reason to re-open this ADR, not as an easy addition.
- **The layout suite currently proves nothing about desktop.** Six of its seven suites run at 390×844, and the single wider test asserts only that nothing overflows. Committing to a designed desktop means assertions above 1280px that can actually fail — [ADR-0016](0016-a-check-must-be-able-to-fail.md).
- **`screen-body.tsx`'s three fixed widths are now the constraint**, along with the header's lack of a content-aligned inner container. That is where the desktop work lives, not in `working-sheet.tsx`.
- **Nothing is built for scale, deliberately.** Under ~25 open Tenders, search, filters, pagination and collapsible groups would be added for a problem that does not exist, and they are the most common route by which a simple app becomes a complicated one. Revisit when a real list stops fitting.
- **The bar must survive an Active Org switcher** for the minority holding more than one Membership, without becoming a third destination for everyone else.

## Amendment, 2 September 2026 — what building the desktop half settled ([#97](https://github.com/Mikepeerawit-com/tender-tracker/issues/97))

The decision above holds unchanged. The tender list joined the Tender detail at `max-w-7xl`, the app bar gained the content-aligned inner container this ADR said it lacked, and the consequence that *"the layout suite currently proves nothing about desktop"* is discharged: `screens.layout.test.tsx` now stands at **1440×900** and asserts the column **every** screen commits to, as a table of widths rather than a floor. 1440 rather than 1280 on purpose — at exactly 1280 a column capped at 1280 and a column that simply took the window measure the same number, so a suite standing there could not tell a committed width from no cap at all (ADR-0016). `auth-screen.layout.test.tsx` pins the other half, that login and its two neighbours stay `max-w-sm` at any width, because *wider* reading as *better* is how the next ticket undoes this one.

**A `max-w-*` sizes the border box**, which is the trap this work fell into and climbed back out of. Putting the cap and the horizontal padding on one element caps the column *including* the padding, so a bar written that way lands exactly one padding inside the body it was aligned to — an alignment fix that misaligns. The bar pads the `header` and caps the `div` inside it, which is the shape `ScreenBody` already had.

**The bar's column is aligned; its ink is not, and that is deliberate.** A ghost control carries its own inset — the wordmark's `px-2`, an icon button's 44px square around a smaller glyph — so a control whose box starts at the column edge draws its mark a padding's width inside it. Pulling each end group back by that inset was written, looked right, and was removed: it works by letting a child overhang its parent, which is what `overflowing` in `@/test/layout` exists to catch, and keeping it meant teaching that guard an exception for the case in front of us. Eight pixels of button padding is cheaper than a hole in the check that catches a row pushing the page sideways.

**What the width does *not* buy.** *(The committed widths this paragraph describes were replaced by ADR-0022's single region; the claim below about what a width does not buy is unchanged and still holds.)*

Nothing about the two Owner screens was redesigned to fill 1280 — the working sheet was already composed for it, and the worklist's rows simply stop wrapping their reference onto a second line. A row rearranged for the desk is a second design of the thing ADR-0009 says should be one, and is a decision for its own ticket if a reader ever asks for it.

## Amendment, 4 September 2026 — Settings is a destination the bar does not carry ([#132](https://github.com/Mikepeerawit-com/tender-tracker/issues/132))

**The set stays capped at two.** *My work* and *Tenders* are still the whole of what both bars draw, and Settings is deliberately not a third: it is reached from the menu behind the trigger, which is where this ADR already put everything rarer than a daily destination. A settings screen most members open twice a year would be a bar item teaching them to ignore the bar, which is the argument that kept "Record a tender" off it.

**What changed is what is behind that trigger.** The menu held four rows for an Org Admin — People, the Group Robot, Converting foreign prices, then Sign out — and one row for everybody else, so opening it as an ordinary member was an anticlimax that teaches somebody to stop opening it. The three are now one row, `Settings`, and Settings is one destination with a **sub-navigation column** in two groups: **Preferences**, which every member has, and **Organisation**, which holds the three and is *not drawn at all* for a member who is not an Org Admin. `CONTEXT.md` defines both terms; this file is only about where they sit.

**The sub-navigation spans the region and is not a sidebar.** ADR-0022 names navigation among the things that span rather than sitting in the measure column, and that is what this is — it is inside one screen's region, beside that screen's own body, not a chrome rail down the side of the app. The desktop sidebar this ADR rejected is still rejected for the reason it gives: a container built for ten items holding two, spending ~240px on every screen including the comparison sheet that can least afford it. This column is drawn on four screens and nowhere else.

**The language switcher left the app bar for Preferences**, which is what makes Preferences worth opening for somebody who administers nothing, and it collects on #56 — the bar carries one control fewer in both scripts than the row that ticket was raised about. The reasoning that put the switcher on the bar, *"a reader who cannot read the language they are looking at needs to see the other one, not find it behind a menu"*, is untouched **on the signed-out screens**: it is still in `AuthScreen`'s footer, at the same 44px targets, because somebody who cannot read the login form cannot get past it. Behind the login a member has already chosen a locale on first start-up, so the argument does not carry there. The switcher's two shapes collapsed into one with the move — the shortened `EN` / `中文` pair existed for the bar's width alone.

**The bar no longer asks who is looking.** `AppHeader` took an `isOrgAdmin` so the menu could draw three extra rows; with those gone there is one bar for every member, `Screen` composes it with no session read at all, and the question is asked once — in `(app)/settings/layout.tsx`, on the screen it decides. It decides only what is *drawn*: each Organisation screen still refuses a non-admin with `notFound()`, so a typed address is no way in either.

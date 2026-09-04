# The visual system is built for a Chinese reader on a phone

The app shipped on stock shadcn tokens — every colour `oklch(… 0 0)`, pure greyscale — and on `Geist({ subsets: ["latin"] })`. Both are defaults nobody chose, and both are wrong for who actually reads this app: an Assignee who taps a Group Robot link and lands in the WeCom in-app webview on a phone, reading `zh-Hans`. This records the two decisions taken in the redesign of 29 August 2026, because both are pervasive, both look arbitrary from the code, and both had a real alternative.

## The CJK face is declared, and drawn by the device

`subsets: ["latin"]` means the working language of this app has no chosen typeface at all: every Chinese glyph falls back to whatever the handset happens to carry, mixed inline with Geist for the numerals. The decision is to **name the fallback stack deliberately** — PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans SC, Microsoft YaHei — and to pick the Latin face to sit beside it rather than in front of it.

**Web-loading a CJK face was the alternative, and it was rejected on delivery, not on taste.** A CJK face cannot be subset the way a Latin one can; it is megabytes, and it would be fetched over a phone network inside a webview, on the exact path a reminder link takes. A screen that has not painted is worse than a screen painted in PingFang.

**The cost, accepted deliberately:** the Chinese glyphs differ between an iPhone and an Android handset, so the two do not render identically. That is the price of the page appearing at all on the connection these users have.

The Latin and numeral face is IBM Plex Sans and IBM Plex Mono, chosen for x-height and stroke weight that sit level with PingFang rather than fighting it — which is precisely what Geist-by-default was doing.

## Colour says one of three things, and never says it alone

Three hues carry meaning, and each is allowed to say one thing:

- **Signal** (teal) — something is expected of the person reading. Primary actions, the Selected Quote, rank 1, the outstanding-for-you band.
- **Alarm** (red) — **time, and only time.** A Submission Missed, a passed deadline, an Item still Not Yet Sourced after the Internal Quote Deadline.
- **Flag** (amber) — a property of a Quote or a figure rather than a state: an Alternative, an Unconfirmed Landed Cost, a ranking too close to call.

**Alarm never touches a money figure**, and that is the surprising rule a future reader will want the reason for. (Still true; the second half of this paragraph is answered by ADR-0023 — see the amendment at the foot of this file.) In Chinese financial convention **red is up and green is down** — the inverse of the Western reading. A red negative Margin would be read as a gain by half the people using this daily. Keeping alarm to deadlines sidesteps the inversion rather than picking a side of it, which is the only move available in an app that ships `en` and `zh-Hans` from one component tree.

**Colour never carries the only copy of a meaning.** The indicator lamp has a shape and a labelled sentence as well as a hue, so the screen survives being read in greyscale, by someone colour-blind, or in sunlight.

## Consequences

- **Labels get one rule per script, not one rule stretched over both.** Latin field labels are uppercase with 0.055em tracking; Chinese has no case and tracking damages it, so CJK labels are sentence-case at a larger size. Anywhere a label is styled, both rules exist.
- **The token file is no longer stock.** Replacing zero-chroma tokens touches every screen at once, which is why this is written down rather than discovered by whoever next runs `shadcn add`.
- **Judge new screens in `zh-Hans` first.** The type scale was set for PingFang and checked against IBM Plex, not the reverse. The current mismatch happened by doing it the other way round.
- **Nothing in the schema moves.** This is a rendering decision end to end, exactly as ADR-0009 was.

## Amendment, 4 September 2026 — the values moved, the meanings did not ([#130](https://github.com/Mikepeerawit-com/tender-tracker/issues/130))

The app was repainted whole, as the first increment of the redesign in [#129](https://github.com/Mikepeerawit-com/tender-tracker/issues/129). Everything this ADR decided still stands; two of the things it *recorded* are now false, and both are recorded here rather than edited above, so that the reasoning that produced them survives its own answer.

**The Latin and numeral face is Fira Sans and Fira Code**, not IBM Plex Sans and IBM Plex Mono. The pairing is taken the way its own note states it — *code for data, sans for labels* — and deliberately not the other reading of it, which puts the monospace on headings: a terminal face set above Han body text is a different app from this one. The reason for the choice is the one this ADR already gives, applied again rather than replaced: a Latin face is picked to sit *beside* PingFang, and it is picked because nothing is fetched for the script the app is actually read in.

**The hues moved, and what each is allowed to say did not.** Signal, alarm, flag and ink mean exactly what they mean above. Two of the moves had a reason beyond taste and are the ones worth having written down:

- **Signal went from teal to blue**, decided against the money colours arriving in [#134](https://github.com/Mikepeerawit-com/tender-tracker/issues/134) rather than on its own. A Margin drawn in green beside a rank-1 chip drawn in teal is two greens on one screen meaning two different things, and the reader has to know which is which before either helps. Blue is unambiguous against both green and red, and it keeps signal reading as *act on this* rather than as *good news*.
- **The ground went from a cool near-white to a warm paper.** This ADR chose "not cream" and the repaint reverses it, for the hue underneath: blue over a cool near-white is the ground of every dashboard, and warm paper under blue ink is a working sheet — which is what this app is.

**`--ink-faint` is materially darker than it was, and `--input` darker still. Both are fixes rather than tastes.** At its old value `--ink-faint` drew 10.5px field labels and reference codes at 3.1:1, under the floor for text that size; primary buttons sat at 4.1:1; and the hairline round a text field — which is how a reader knows it *is* a field, and therefore information rather than decoration under WCAG 1.4.11 — sat at 1.3:1 against the ground. All three were invisible for as long as nobody measured them.

`src/app/contrast.layout.test.tsx` is what measures them now. It walks every screen in `@/test/screens` **and the signed-out ones**, in both locales, **both themes** and at **both widths** — the phone in the webview and the Owner's desk, because an element the phone does not draw is an element the walk cannot see. It composites the washes the way the compositor does, holds every word to 4.5:1 (3:1 where the text is large enough for WCAG to allow it), and every field's boundary to 3:1. The rules that merely divide rows are deliberately *not* held to that: they separate what position already separates, and a 3:1 rule between every row would draw a spreadsheet.

It names no token and compares no pixel: the values stay free to move, and what is pinned is that whatever they move to stays readable.

**The `.dark` block was repainted in the same pass**, though nothing turns it on yet. A theme nothing switches on is exactly the one that goes stale, and it is measured by the same guard as the light one, so it is a deliberate answer rather than a leftover. The theme is a parameter of the **shared screen wrapper** rather than of the suite that happens to want it, so a screen added to the record is measured in both themes by whatever already measures it; and the guard asserts that the ground it measured really is the theme it asked for, because a `.dark` that stopped applying would otherwise measure the light palette twice and report the dark one green. Two things in it were quietly wrong and are now fixed: `--destructive` aliased `--alarm` there while the light block went to some trouble to keep them apart, and the hairlines were white at 12% rather than a stated colour.

**Unchanged, and load-bearing:** no CJK webfont is fetched and the stack is declared in full and drawn by the device; the `var()` fallbacks name the Latin family so that anything rendering without `next/font` keeps the whole stack (`src/app/type.layout.test.tsx` is that condition, asserted); colour never carries the only copy of a meaning; alarm is time and only time, and no Margin is given an alarm tone. **Judge new screens in `zh-Hans` first** still holds — read it now as *checked against Fira*.

## Amendment, 4 September 2026 — the inversion is answered rather than sidestepped ([#134](https://github.com/Mikepeerawit-com/tender-tracker/issues/134))

This ADR's money rule had two halves, and only one of them survives.

**Alarm still never touches a money figure**, exactly as stated above. What is no longer true is the sentence after it — that keeping alarm to deadlines *"sidesteps the inversion rather than picking a side of it, which is the only move available in an app that ships `en` and `zh-Hans` from one component tree"*. There was a third move, and ADR-0023 takes it: a change figure carries its own hue, and **the hue is chosen by the locale the screen is rendered in** — red for a gain in `zh-Hans`, green for a gain in `en`. One component tree, two conventions, no reader preference.

The direction hues are **their own tokens**, `--money-red` and `--money-green`, precisely so that this ADR's reservation of alarm for time and only time survives the change: re-hueing alarm must not repaint every gain in the app. And they are named by hue rather than by meaning — the one place in the token file where that is right, because here the value is the fixed thing and the meaning is what moves with the language.

**Colour never carrying the only copy of a meaning is what makes it safe**, and it is load-bearing here rather than a courtesy: every directed figure also draws a triangle and an explicit sign, both identical in the two locales. That is what a greyscale print, a phone in sunlight, a colour-blind reader — and a screenshot pasted into a WeCom group and opened by somebody reading the other convention — are left with.

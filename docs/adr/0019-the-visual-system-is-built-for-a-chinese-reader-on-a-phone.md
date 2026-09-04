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

**The `.dark` block was repainted in the same pass**, though nothing turns it on yet. (Something does now — see the second amendment at the foot of this file.) A theme nothing switches on is exactly the one that goes stale, and it is measured by the same guard as the light one, so it is a deliberate answer rather than a leftover. The theme is a parameter of the **shared screen wrapper** rather than of the suite that happens to want it, so a screen added to the record is measured in both themes by whatever already measures it; and the guard asserts that the ground it measured really is the theme it asked for, because a `.dark` that stopped applying would otherwise measure the light palette twice and report the dark one green. Two things in it were quietly wrong and are now fixed: `--destructive` aliased `--alarm` there while the light block went to some trouble to keep them apart, and the hairlines were white at 12% rather than a stated colour.

**Unchanged, and load-bearing:** no CJK webfont is fetched and the stack is declared in full and drawn by the device; the `var()` fallbacks name the Latin family so that anything rendering without `next/font` keeps the whole stack (`src/app/type.layout.test.tsx` is that condition, asserted); colour never carries the only copy of a meaning; alarm is time and only time, and no Margin is given an alarm tone. **Judge new screens in `zh-Hans` first** still holds — read it now as *checked against Fira*.

## Amendment, 4 September 2026 — the inversion is answered rather than sidestepped ([#134](https://github.com/Mikepeerawit-com/tender-tracker/issues/134))

This ADR's money rule had two halves, and only one of them survives.

**Alarm still never touches a money figure**, exactly as stated above. What is no longer true is the sentence after it — that keeping alarm to deadlines *"sidesteps the inversion rather than picking a side of it, which is the only move available in an app that ships `en` and `zh-Hans` from one component tree"*. There was a third move, and ADR-0023 takes it: a change figure carries its own hue, and **the hue is chosen by the locale the screen is rendered in** — red for a gain in `zh-Hans`, green for a gain in `en`. One component tree, two conventions, no reader preference.

The direction hues are **their own tokens**, `--money-red` and `--money-green`, precisely so that this ADR's reservation of alarm for time and only time survives the change: re-hueing alarm must not repaint every gain in the app. And they are named by hue rather than by meaning — the one place in the token file where that is right, because here the value is the fixed thing and the meaning is what moves with the language.

**Colour never carrying the only copy of a meaning is what makes it safe**, and it is load-bearing here rather than a courtesy: every directed figure also draws a triangle and an explicit sign, both identical in the two locales. That is what a greyscale print, a phone in sunlight, a colour-blind reader — and a screenshot pasted into a WeCom group and opened by somebody reading the other convention — are left with.

## Amendment, 4 September 2026 — something turns it on ([#133](https://github.com/Mikepeerawit-com/tender-tracker/issues/133))

The paragraph above bets that a theme nothing switches on goes stale unless the same guard walks it. The bet paid: #133 gave a member the switch — System, light or dark, from Settings → Preferences — and the palette it turns on is the one measured here all along, so turning it on needed no new legibility argument and no repaint.

Two things in this ADR's account of the guard have moved with it. **Dark is now reached two ways** rather than one: the `.dark` class the server writes when a reader has pinned it, and a `prefers-color-scheme` media query under `.theme-system` for a reader who left it to their device. The declarations are stated once and expanded into both by Tailwind's `@variant`, so the repaint rule above — a hue may change, what it is allowed to say may not — is unaffected by there being two readings.

**And the walk in `contrast.layout.test.tsx` is no longer the only browser seam that cares about a theme.** It still measures both palettes on every screen, which is the claim that matters; what it cannot say is *which* palette a given reader gets, because it applies the class itself. `theme.layout.test.tsx` is where that half lives, emulating an operating system's preference over CDP. See [ADR-0024](0024-the-theme-is-the-readers-not-the-devices.md) for why the choice is remembered on the user rather than the device.

## Amendment, 4 September 2026 — the dark theme swept, and two rules the visual system had never stated ([#135](https://github.com/Mikepeerawit-com/tender-tracker/issues/135))

The amendment above bets that a theme walked by the same guard as the light one is a deliberate answer rather than a leftover. The sweep that cashes the bet found three faults, and **not one of them was in the dark palette.** That is the finding worth writing down: what was broken was never the values, it was which surfaces anybody had thought to measure.

**The comparison working sheet was outside `@/test/screens`, and therefore outside every shared guard.** It was measured only by its own suite, on a bare page, in one locale and one theme — so `--money-red` and `--money-green`, which [#134](https://github.com/Mikepeerawit-com/tender-tracker/issues/134) had just introduced, were drawn on no screen anything could see. It is in the record now, inside the Owner's Tender detail where the router really puts it, and it brought two faults with it:

- **The sheet pushed a 390px phone sideways** on the unbroken product names a client really supplies. Its own suite composes names with spaces in them, so the row that has to break had never met a word that could not. `min-w-0` was already there and does not help on its own — `items-start` sizes each child to its own longest word, so the hold needs `max-w-full` beside `break-words`.
- **`--ink-faint` was under the floor again**, at 4.48:1, and in the *light* theme. The amendment above calls it "the lightest ink that clears 4.5:1 on both the paper and a sheet"; there is a third surface, the `muted/40` wash the sheet's header and totals bar are drawn on, and it is darker than either. The value moved to `oklch(0.535 0.018 265)`. **The lesson is the one this ADR keeps relearning: a token's contrast claim is a claim about a list of surfaces, and the list is only as long as the screens somebody measured.**

**The focus ring is now part of the visual system, and it is signal at full strength.** It had never been decided: the fields and buttons carried shadcn's `ring-ring/50` and a link carried whatever the browser drew, tinted by an `outline-ring/50` on `*`. Half strength measures 2.6:1 on the paper and 2.3:1 on the dark ground — under WCAG 1.4.11's 3:1 in **both** themes, which is why this is a decision about the system rather than a patch to the dark block. Signal is the hue for *something is expected of the person reading*, and a control holding the caret is the clearest case of that in the app, so it is drawn at the strength that says so: `:focus-visible { outline: 2px solid var(--ring) }` in `@layer base`, with each component's own ring taken to full opacity.

**Reduced motion is answered once, for everything.** `prefers-reduced-motion` is set by people for whom movement causes nausea, migraine or vertigo, so it is not a taste and it is not a per-component courtesy: `ScreenSkeleton` was the only thing in the app that honoured it, and every `transition-colors` and both pending spinners ran against it. One unlayered block in `globals.css` now takes animation and transition duration to zero — unlayered because a rule in an earlier cascade layer loses to a Tailwind utility in a later one however specific it is. The skeleton's own `motion-reduce:animate-none` went with it: a rule stated twice has one place a reader will look and one place they will not.

**Three suites walk the screen records now, not one.** The amendment above says `contrast.layout.test.tsx` "is what measures them"; it is now what measures the *words*. `focus.layout.test.tsx` tabs every control on every screen in both themes and holds whatever focus changed to 3:1 — Tab rather than `focus()`, because `:focus-visible` is a claim about how focus arrived. `motion.layout.test.tsx` emulates the preference over CDP and asserts nothing moves, paired with a suite asserting the app *does* move without it, so the guard cannot pass by measuring an app with no motion in it (ADR-0016). The compositing they share lives in `src/test/colour.ts` rather than in three copies.

**And the signed-out screens are a record rather than one screen somebody remembered.** Only the sign-in screen was ever measured, hand-composed in two suites, on the reasoning that `LoginForm` is the busiest of the three forms. True of a *width*; false of a colour. All four are in `signedOutScreens` now, and `/choose-language` grew a component so that what is measured is the page rather than a copy of its markup.

**One thing deliberately not changed.** The criterion this ticket was written to says *"text and hairlines meeting contrast on the dark ground"*, and `--border` is still not held to 3:1 — in either theme. That is this ADR's existing rule, not an oversight: the rules between rows separate what position already separates, and holding every one of them to 3:1 draws a spreadsheet. What *is* held to it is the boundary of a field, which is how a reader knows it is a field. If that is ever reopened, it is a decision about the visual system and belongs in an amendment here rather than in a guard.

## Amendment, 4 September 2026 — the tap floor is part of the visual system, and it was never measured ([#142](https://github.com/Mikepeerawit-com/tender-tracker/issues/142))

The amendment above put the focus ring into this system on the reasoning that it *"had never been decided"* — every control carried whatever shadcn or the browser drew, and nobody had said what the app meant. The 44px tap floor is the same fault one layer out: it *had* been decided, in `buildspec_2`, and it was never made anything a build could check.

`buildspec_2` states it twice, and both times as a thing a person does — *"judge at 390px on a real phone, not a narrowed desktop window — tap targets are floored at 44px, which a resized browser will not surface"*, and then, in the list of what is left to the eye, *"44px tap targets and the density feel"*. `docs/simplification-scope.md` is why that is not enough, and it is the same argument that put `density.layout.test.tsx` in the repo at all: **no colleague tests this work before it ships**, so a rule whose only enforcement is a judgement nobody is rostered to make is a rule the app drifts away from silently. It had. Four controls on the Assignee's own screens were drawn 28px high, through five repaints, and nothing in the build could say so.

**What was broken is again not the values — it is which surfaces anybody had thought to measure.** The chrome was never at fault. `AppNav`, `AppMenu`, `AppHeader`, `ThemeSwitcher` and `LocaleSwitcher` each carry an explicit `min-h-11` or `size-11` *and* a suite asserting it, and each of those suites names the 44px floor in its own comment. What had no guard was the page body — the region the Assignee actually works in — and there the floor was reached by remembering to write `className="h-11"` beside `size="sm"`. `SourcingList` remembers; `WorkingSheet` remembers. `QuoteRowControls`, `QuotePhotos`, `ReferenceImageGallery` and `AssigneeControls` did not, and there was no way to tell. **A floor that is opt-in per call site is a floor the next call site is free to miss**, which is why the answer is a property of every screen rather than four more `h-11`s and a note asking people to be careful.

`src/app/target.layout.test.tsx` is what measures it now. It walks the same records as the contrast, focus and motion suites, holds every drawn control to 44px in both dimensions, and measures **the box the control was drawn at** rather than the class it was given — a control handed `h-11` and squeezed by its parent fails, and a control handed nothing that got there on padding passes.

Three choices in it are the reverse of the neighbouring suites' and are made deliberately:

- **At 390px alone.** The floor is a claim about a thumb. A mouse is not a thumb and a 28px button under a pointer is not the same fault, so measuring the desk would assert a rule nobody wrote.
- **In both locales**, where `focus.layout.test.tsx` stands in `en`. That suite asks a colour question and a ring does not change width with the script. This one is geometry end to end, and a Han glyph is about twice the width of a Latin letter — the reason `density.layout.test.tsx` budgets the two locales separately rather than taking the larger.
- **In one theme**, where the contrast walk takes both. A theme changes what a control is painted in and nothing about the box it is painted in; walking both would re-measure identical rectangles. `light` is named rather than defaulted, so that the day the themes differ in geometry is a day somebody has to come here and say so.

**The floor is `buildspec_2`'s 44, not WCAG's 24, and the spacing exception is deliberately not implemented.** WCAG 2.2 SC 2.5.8 lets an undersized target pass when nothing else comes within 24px of it. This app's number is the larger one and it is a floor on the target rather than on the gap, so a control that would need the exception is a control to make bigger.

**One thing deliberately not reached**, stated the way the amendment above states its own: controls that exist only after an interaction — the image lightbox, and the Remove on a photo picked but not yet saved — are drawn by no screen at rest and are in no record this walks. `QuoteForm`'s held-photo Remove is the live one, and it was fixed alongside the four on the strength of being the same control rather than on the strength of being measured.

**Two neighbouring faults this walk did not fix, and both are the same shape as the one it did.** [#143](https://github.com/Mikepeerawit-com/tender-tracker/issues/143): `/tenders/new` and `/tenders/[id]/edit` are not in `@/test/screens` and are therefore outside *every* shared guard — which is precisely what the amendment above found of the working sheet, one ticket after writing the lesson down. [#144](https://github.com/Mikepeerawit-com/tender-tracker/issues/144): fifteen submit buttons answer a press with `disabled:opacity-50` and no word, which on the phone network this system was designed around is the case that produces a second press — and which the reduced-motion block above makes into a rule rather than a taste, since a reader who asked for stillness gets a spinner that does not spin.

# A Margin's direction hue is decided by the locale it is rendered in, not by the reader

_Written by [#134](https://github.com/Mikepeerawit-com/tender-tracker/issues/134), ticket 3 of [#129](https://github.com/Mikepeerawit-com/tender-tracker/issues/129)._

**Status:** accepted. Amends ADR-0019, which reserved alarm for time *and* used that reservation to sidestep the red/green inversion entirely; the inversion is now answered rather than avoided. Nothing is superseded — alarm still never touches a money figure.

A Margin was a plain figure. Nothing on it said which way it went, and the only marking a negative one carried was the minus sign `Intl` put in front of it. ADR-0019 states the reason for that restraint plainly: **in Chinese financial convention red is up and green is down**, the inverse of the Western reading, so a red negative Margin would be read as a *gain* by half the people using this app daily. Keeping colour off money was the only move available at the time, and it was the right one — but it is a refusal, and the cost of it is that the densest, most-read figure on the working sheet says less than every other figure around it.

**The decision: a change figure carries a direction glyph, an explicit sign, and a hue chosen by the language the screen is being rendered in.** A gain is red in `zh-Hans` and green in `en`. A loss is the other way round in each. **There is no per-reader override, and that is the decision rather than an omission.**

## Why the locale, and not the reader

The obvious alternative — a preference on the user record, beside the theme and the language — was considered and rejected on one argument.

**A screenshot has no toggle inside it.** The single most common thing that happens to this screen is that somebody photographs it and pastes it into a WeCom group. Whoever opens it there is not the person who rendered it, has no preference of theirs attached, and cannot ask. If the hue followed the reader, an image would mean one thing on the desk it was taken from and the opposite thing in the group it was pasted into, and nothing on the pixels would say which. Tying the hue to the rendered locale makes the image self-describing: it is red-for-gain *because* it is a Chinese screen, and the Chinese words all round the figure say so.

The second argument is smaller and points the same way. A per-reader override is a setting whose whole purpose is to make two colleagues' screens disagree, in an app built so that two colleagues can compare the same Tender. It buys one person comfort and costs the pair a shared reference.

## Why the glyph and the sign are not optional

**Colour never carries the only copy of a meaning** (ADR-0019), and here it carries the *inverted* copy, which raises the stakes on the other two.

Three readers need them. Someone printing the sheet in greyscale, someone reading a phone in sunlight, and a colour-blind reader all get the whole meaning from a triangle and a `+`. So does a fourth: the person looking at a screenshot rendered in the convention they do not use. The triangle points the same way in both locales and the `+` is a `+` in both; only the hue inverts. That is what makes a screenshot survive crossing the convention.

It is also what keeps **a passed deadline distinguishable from a healthy Margin**. In `zh-Hans` both are red, and both appear on the Tender detail. **What tells them apart first is form, not hue**: one is a tabular figure carrying a triangle and an explicit sign, the other a sentence beside a lamp. That is the mitigation, and it is the one that survives a reader who cannot tell the two reds apart at all.

The hue is a second line of defence, and it is a real one — but only because the values were separated deliberately. The token a reader actually meets on a passed deadline is `--alarm-ink`, not `--alarm`, and the first cut of `--money-red` landed within five degrees of it: two tokens the file claimed were distinct and a screen would have rendered as one colour. Money red is now the colder crimson and alarm ink the warmer, more orange red. **Anyone re-hueing either should check it against the other**, because nothing measures this — the working sheet is not in the shared screen record, so the contrast guard walks neither token.

## Why the hues are their own tokens

`--money-red` and `--money-green` are their own token roles, and neither is `var(--alarm)` or `var(--destructive)`.

ADR-0019 reserves alarm for **time, and only time**, and a Margin is not time. If money red were an alias, a future re-hue of alarm — one of the two open risks the parent spec names, and the fallback if two reds on one screen prove to be one too many — would silently repaint every gain in the app, and the token file would state a rule and break it four lines later. They are two meanings that happen to share a hue family; a reader changing one should have to decide about the other. This is the same argument `--destructive` already carries in that file, applied a third time.

**They are named by hue rather than by meaning, which is the one place in this codebase that is right.** Every other token says what it means — signal, alarm, flag — because the meaning is fixed and the value is free to move. These two are the inverse: the hue is the fixed thing, and *what it means is decided by the reader's language*, so a name like `--gain` would be true in `en` and false in `zh-Hans`.

## What is not coloured

**Absolute prices stay uncoloured.** A unit price, a line total, a Bid total and a Landed Cost are amounts of money rather than movements of it. Colour on a figure means direction, always, or the reader has to know which kind of figure they are looking at before the hue tells them anything — which is worse than no hue at all.

**A provisional Margin is still provisional, and direction does not overrule it.** A Margin derived from an Unconfirmed Landed Cost is understated in cost and overstated in profit (ADR-0014), and putting a triangle on it would dress up a figure that is not yet a figure — on the exact number somebody is about to bid. Provisional outranks direction, on the working sheet's rows and in its totals bar alike.

**An Assignee still sees no money at all.** ADR-0020 stands untouched: the comparison is the Owner's act, and nothing here puts a figure on an Assignee's screen.

## Consequences

- **The rule lives in one pure module** — `@/lib/money/direction` — that takes an amount and a locale and returns a direction, a tone, a glyph and a sign. Nothing renders in it, so the rule can be asserted as a table of cases in the server project, with no browser and no database.
- **Nothing tests a rendered colour.** A test that read a computed hue off the DOM would be testing the token file, which this decision deliberately leaves free to move. What is pinned is which case maps to which direction in which locale — gain and loss in both languages, zero, the provisional figure and the absent one.
- **A third locale is a type error, not a silent grey figure.** The gain-hue map is keyed by `Locale`, so adding a language forces somebody to decide which convention it reads in.
- **The direction word is the glyph's accessible name.** The triangle is `aria-hidden` and a screen reader hears "Gain" / 盈利 instead, so the catalogue is walked by `messages.test.ts` the way every other rendered union is: a fourth direction cannot ship unnamed.
- **The open risk is two reds, and it is judged on a real screen.** If a gain and a passed deadline in `zh-Hans` still read as one thing to a person looking at the Tender detail, the fallback is to re-hue alarm and free red for money entirely — which is exactly why alarm was not aliased here.

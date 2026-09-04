# The theme is remembered on the user, not on the device

_Written by [#133](https://github.com/Mikepeerawit-com/tender-tracker/issues/133), ticket 5 of [#129](https://github.com/Mikepeerawit-com/tender-tracker/issues/129)._

**Status:** accepted. Extends [ADR-0011](0011-locale-is-not-in-the-url.md), which settled the same question for the language, to the second thing that is the reader's alone. Nothing is superseded. [ADR-0019](0019-the-visual-system-is-built-for-a-chinese-reader-on-a-phone.md)'s rule about what each hue is allowed to say is untouched: the dark palette repainted in [#130](https://github.com/Mikepeerawit-com/tender-tracker/issues/130) says exactly what the light one says, and this ticket only decides who turns it on.

A dark theme has been fully defined in the token file since #130 and nothing in the app has ever applied it. #133 gives a member the switch: **System, light or dark**, from Settings → Preferences, with System the default.

## The decision

**The choice is stored on `users.theme`, per member, and it follows them to the next device.** It is `not null default 'system'`, joins the `update (name, locale)` column grant, and inherits the restrictive own-row policy that already covers every column on that table — so a member may write their own and may not write a colleague's.

**The renderer reads a cookie; the row is what remembers.** The root layout resolves the theme before any page knows who is looking, and signing in copies the row into the cookie. This is `NEXT_LOCALE` and `users.locale`'s existing division, for the same two reasons: the signed-out screens are painted too, and a layout that read the session to decide a colour would put a round trip in front of every page in the app.

**System is resolved by a `prefers-color-scheme` media query in CSS, not by a script.**

## Why per user rather than per device

This is the same argument `users.locale` already won, and it is worth stating rather than inheriting, because the intuition points the other way: a theme _feels_ like a property of the screen you are holding.

- **The reason somebody wants dark is usually about them, not about the handset.** A member who finds the light palette hard on their eyes finds it hard on the office desktop too. Storing it on the device means choosing it again on every device, and the second time it silently reverts nobody trusts the control.
- **The devices in this product cannot be relied on to remember anything.** Research 17 measured it: cookies and `localStorage` in the WeCom in-app webview do not survive seven idle days, and a reminder link tapped a fortnight later arrives with an empty jar. A device-local theme in this app is a theme that quietly resets on exactly the path the product is built around. The row is what survives that; the cookie in front of it is a cache, not the answer.
- **It is one column on a table that already has this shape.** `locale` established that a member's own preferences live on their own row under a column grant and an own-row policy, so the cost here is a column and a grant rather than a mechanism.

**And it is deliberately the opposite of an organisation-level setting.** A deadline's timezone or the FX Buffer are the org's: they change what a _colleague_ sees, so they sit in Settings → Organisation behind the Org Admin capability. A theme changes nothing anybody else looks at, which is precisely why it belongs in Preferences beside the language and why it needs no gate at all.

**System is a stored answer, not a null meaning "never asked".** A member who pins dark on a phone and later returns to System has _done_ something, and a null could not tell that from an untouched row. It also means there is no `/choose-theme` standing in front of the app the way `/choose-language` does — the language had to be asked because inferring it from `Accept-Language` would silently hand two colleagues different apps, whereas following the device is a good answer that costs nobody a question.

## How System is answered without a flash

`System` needs the operating system's preference, which the server cannot see, and the flash this is guarding against is not hypothetical: the reminder link lands in the WeCom in-app webview on a phone network, the slowest path in the product and the one where a white flash before a dark page lasts longest.

**The server writes the class, the stylesheet asks the device.** A pinned theme is `class="dark"` — or the absence of a class, since `:root` _is_ the light palette — and arrives in the first byte of the markup. System is `class="theme-system"`, and `globals.css` resolves it with `@media (prefers-color-scheme: dark)`, which is answered during the browser's first style resolution, before anything is painted.

Two alternatives were considered and rejected:

- **An inline script in `<head>` that reads `matchMedia` and adds the class.** This is the common solution and it does run before first paint, but it makes the app's legibility depend on script execution and on a Content-Security-Policy allowance, and it paints from JavaScript what the CSS could have decided on its own. A media query has no such failure modes.
- **`color-scheme` plus `light-dark()`**, which would state each token's two values in one place with no media query at all. Rejected on reach — but the honest form of that argument is about _how each one fails_, not about which is supported, because the Android WeCom webview is a Tencent build of an unstated Chromium version and research 17 §2 says so as an inference rather than a measurement (its live check L2 is still unrun). `prefers-color-scheme` is Chromium 76 and `light-dark()` is Chromium 123, so both are bets on the same unknown. They break differently. An engine that does not know the media query ignores it and paints a reader on System light — which is what every reader got before this ticket, with a pinned theme still working, since pinning is a plain class. An engine that does not know `light-dark()` finds every token invalid at computed-value time and paints an app nobody can read. **One degrades to the status quo and the other to unusable**, and that is the whole of the choice between them.

**The dark palette is still stated once.** Tailwind's `@custom-variant`/`@variant` expands one block of declarations into both selectors — the pinned class and the media query — so a repaint moves one list of values and the two readings of "dark" cannot drift apart.

## Consequences

- **A signed-in member's theme reaches a new device at sign-in, and not before.** The row is copied into the cookie when they sign in; a signed-out screen on a browser that has never seen them is painted System, because there is nobody to ask. That is the same posture the language has, and the same one it will keep.
- **The one case where cookie and row disagree is a live session that lost its cookie**, which research 17 says happens in the WeCom webview after seven idle days while a 30-day session is still good. That reader is painted System and the control says System, because the control reports what the page is _painted_ in rather than what is remembered — the two agreeing is worth more than either being right alone, and one press reconciles both. Reading the row instead would put a "who is looking" round trip in front of every page including the signed-out ones, and a Server Component cannot write the cookie back even once it knows. `locale` has the identical gap and answers it the identical way; the day one is worth closing, both are.
- **`color-scheme` is set alongside the tokens**, so the canvas the browser paints before the stylesheet arrives, and every native control, scrollbar and date picker, match the theme. Without it a dark screen has one light thing on it and a slow load starts white.
- **`prefers-color-scheme` is now load-bearing in a test seam.** `theme.layout.test.tsx` emulates the operating system over CDP and asserts what each of the three answers paints against a device that disagrees. Nothing else in the suite could have caught a dead media query: every component test and every screenshot passes on an app where all three choices paint the same screen. **The emulation is desktop Chromium**, which is what a CI machine has — it is evidence about the CSS and not about the webview, and the bullet above is what stands in for the handset nobody has tapped yet.
- **Three failures were produced rather than imagined** ([ADR-0016](0016-a-check-must-be-able-to-fail.md)). Dropping `theme-system` from `themeClassName` fails the System walk and the `color-scheme` assertion; deleting the class from the root layout's `<html>` fails `layout.test.tsx`; removing the line that copies the row into the cookie at sign-in fails `actions/auth.test.ts`. All three are single lines whose absence is otherwise silent — the app would simply be light for everybody who asked for anything else.
- **The contrast guard already walks both palettes** on every screen in the shared record ([#130](https://github.com/Mikepeerawit-com/tender-tracker/issues/130)), so turning dark on does not need a new legibility argument — it needs the one that was already made to keep holding. The working sheet remains outside that record, which is a known gap rather than a new one.
- **A fourth theme is a real change, not a value.** `themeChoices` is walked by the switcher, the messages guard and the column's check constraint; adding to it means a string in both locales and a migration, which is the right price for a fourth answer.

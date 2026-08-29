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

**Alarm never touches a money figure**, and that is the surprising rule a future reader will want the reason for. In Chinese financial convention **red is up and green is down** — the inverse of the Western reading. A red negative Margin would be read as a gain by half the people using this daily. Keeping alarm to deadlines sidesteps the inversion rather than picking a side of it, which is the only move available in an app that ships `en` and `zh-Hans` from one component tree.

**Colour never carries the only copy of a meaning.** The indicator lamp has a shape and a labelled sentence as well as a hue, so the screen survives being read in greyscale, by someone colour-blind, or in sunlight.

## Consequences

- **Labels get one rule per script, not one rule stretched over both.** Latin field labels are uppercase with 0.055em tracking; Chinese has no case and tracking damages it, so CJK labels are sentence-case at a larger size. Anywhere a label is styled, both rules exist.
- **The token file is no longer stock.** Replacing zero-chroma tokens touches every screen at once, which is why this is written down rather than discovered by whoever next runs `shadcn add`.
- **Judge new screens in `zh-Hans` first.** The type scale was set for PingFang and checked against IBM Plex, not the reverse. The current mismatch happened by doing it the other way round.
- **Nothing in the schema moves.** This is a rendering decision end to end, exactly as ADR-0009 was.

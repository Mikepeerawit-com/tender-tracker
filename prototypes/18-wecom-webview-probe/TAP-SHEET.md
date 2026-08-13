# Tap sheet — iPhone

~10 minutes. Open the link **from the robot's message in the WeCom group**, not from
Safari and not from a pasted URL — the entry path is half of what is being tested.

Answer in the issue in this order. **Boring answers are results too** — say "no banner"
rather than skipping the row. Where something contradicts
[`docs/research/17-wecom-webview.md`](../../docs/research/17-wecom-webview.md), say so
loudly; a contradiction is the most valuable thing this run can produce.

---

### L1 · Does it open, and is there a banner?

Tap the link in the group message.

- Does the page open at all?
- Look at the **very top and bottom**, outside the page — any warning strip
  (防欺诈盗号 / anti-fraud / "this page is provided by a third party")?
- If yes: **screenshot it**, and say whether it **blocks** (you must tap through) or
  merely **warns** (it just sits there).

> Prior: research §1 says it opens with no ICP filing and no Trusted domain name, but
> §1.4 expects a permanent banner this org cannot remove. If the page does **not** open,
> that overturns the whole entry path and ticket 17 was wrong.

### L2 · Engine — read the two lines in the L2 box

- Does the UA contain `wxwork`? (the big green/red line answers this)
- Copy the **Engine tokens** line verbatim.

> On iOS expect `Version/` + `Safari/` — WKWebView. There is no TBS/XWEB on iOS; those
> are the Android question. Anything reporting below `Chrome/90`-era capability would
> threaten the compression step.

### L3 · Does storage survive a force-quit?

1. Note the **Written at** timestamp in the L3 box, and the cookie value in L3b.
2. **Force-quit WeCom** — swipe up, flick the card away. Not just background it.
3. Reopen WeCom, go back to the group, tap the link again.

- L3 State: `PERSISTED` (same timestamp) or `NEW — just written`?
- **L3b State**: `PERSISTED` (same value) or `NEW — just set`?

> This is the row ADR-0006 rests on. `NEW` on **both** means the webview throws storage
> away on quit and the session model needs more than the cookie fix. `PERSISTED` on the
> cookie and `NEW` on localStorage would be the cleanest possible confirmation that
> [research §3.4](../../docs/research/17-wecom-webview.md)'s `@supabase/ssr` fix is right.

### L4 · The camera

Tap **Tap to open the picker**.

- What appears — camera straight away, a chooser sheet, a gallery, or **nothing**?
- If a sheet appears, **list its options verbatim** (e.g. "Take Photo", "Photo Library",
  "Choose File").
- Take a photo. Return to the page. Do `name`, `type`, `size` and `natural` fill in?
- **Did anything crash or reload** on returning from the camera?

> `capture="environment"` asks for the camera directly. iOS is documented to honour it;
> if you instead get a chooser, that is WeCom overriding the hint and it means the
> add-quote screen needs a visible fallback rather than assuming the camera opens.

### L5 · The escape hatch

Find WeCom's **⋯** menu (its own chrome, not the page).

- Is there an **open in browser** action?
- **How many taps** from the page to actually landing in Safari?
- Record the **exact label in English**.

> §6.1: there is no programmatic escape — `ww.openDefaultBrowser` is PC-only *and*
> JS-SDK-gated. So the manual route is the only route, and its tap count decides whether
> "just open it in Safari" is honest advice or a fantasy.

### L6 · Compress & upload

With a photo selected, tap **Compress & upload**.

- **Compression** box: which `path` — `createImageBitmap` or `stepped canvas halving`?
  Output dimensions and KB?
- **Blank/black check**: green `OK — N distinct colours`, or red `UNIFORM`?
- **Upload**: the HTTP status. A bare `TypeError: Failed to fetch` is what a CORS
  rejection looks like.
- **The preview image**: a real photo, a chequerboard (nothing rendered), or a flat
  black/white rectangle?

> Supabase's CORS and this exact code both already passed from a desktop browser, so a
> failure here is WeCom's webview or WebKit's canvas ceiling (§5.3) — which is precisely
> what could not be answered without a phone. A `UNIFORM` result on a 12 MP photo is the
> §5.3 folklore turning out to be real, and it would change what the upload path has to do.

---

### Not on the sheet, on purpose

- **The seven-day storage cap.** Needs seven idle days; documented well enough not to
  need confirming. The `@supabase/ssr` cookie fix ships either way — this run cannot
  overturn it, only add to it.
- **Android.** Not run: no device. §4.2's "WebView will cancel all file requests"
  asymmetry stays **unmeasured**, and `buildspec_2` must say so rather than implying L4's
  iOS result covers both.

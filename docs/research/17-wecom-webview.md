# 17 — Can the WeCom in-app webview carry the reminder → app → upload path?

Findings for [issue #18](https://github.com/Mikepeerawit-com/tender-tracker/issues/18).
Desk research 2026-08-13, primary sources only. **No device was touched** — §7 specifies
the one live check that is needed and exactly what to tap.

Every claim below carries a confidence label: **[documented]** (a vendor states it),
**[widely-reported]** (consistent third-party or user-community reports, no vendor
statement), **[inferred]** (my reading of documented facts, stated as such).

| # | Question | Verdict | Confidence |
|---|---|---|---|
| **1** | Does **Trusted domain name** gate plain link-tapping? | ✅ **NO. The entry path lives.** | **documented** |
| 1b | Does an unfiled domain get an anti-fraud banner? | ~~⚠️ **Yes, over the login form** — and permanently~~ ✅ **NO — measured, ticket 18 L1.** The inference in §1.4 was wrong | ~~documented + inferred~~ **measured** |
| 2 | What is the webview? | iOS `WKWebView`; Android Tencent engine, version unknown | documented + inferred |
| **3** | Do cookies/`localStorage` survive app restarts? | ⚠️ **Restarts yes. Seven idle days, no** — and this hits Mobile Safari too | **documented** |
| 4 | Does `capture="environment"` open the camera? | iOS ✅ by design · Android ❓ **WeCom's choice, reported flaky** | documented + widely-reported |
| 5 | Cross-origin `PUT` to Supabase Storage? | ✅ Nothing on WeCom's side. The risk is Supabase-side | documented absence + widely-reported |
| 6 | Escape hatch to a real browser? | ~~Manual ✅ ·~~ **Manual ❌ too — measured, ticket 18 L5.** Programmatic ❌ dead twice over · detection ✅. **There is no escape** | ~~documented~~ **measured** |

**Headline: the ticket's catastrophic outcome did not happen.** Tapping a robot-message
link opens the page. The Trusted domain name wall that ticket 06 hit does not stand in
the entry path. What the research *did* surface is a different problem the ticket did not
ask about — **ADR-0006's 30-day session does not survive seven idle days on iOS**, in
Mobile Safari as much as in WeCom — and it has a cheap fix that must be written into
`buildspec_2` or it will be discovered in production.

---

## 1. The Trusted domain name question — the gate does not apply to link-tapping

This is the answer the ticket said mattered more than anything else, so it gets the space.
The finding rests on two independent legs: the gate names its own scope, and WeCom's own
FAQ proves an unqualified domain still renders.

### 1.1 The gate names its own scope

- **The console field lives in a section called Web Authorization and JS-SDK**
  (网页授权及JS-SDK). Ticket 06 §8 read the panel directly and recorded a *second*
  field beside it — the JS-SDK list, "up to 10 domain names". The section names the two
  things it governs, and neither is "opening a URL". **[documented]** (ticket 06 §8)
- **The JS-SDK doc scopes it to JS interfaces**, verbatim from
  [开始使用 · 90514](https://developer.work.weixin.qq.com/document/path/90514):
  > 所有的JS接口只能在企业微信应用的可信域名下调用(包括子域名)，且可信域名必须有ICP备案且在管理端验证域名归属。

  *All **JS interfaces** may only be called under the app's trusted domain.* The subject
  of the sentence is `JS接口`, not `页面`. **[documented]**
- **The OAuth doc binds it to `redirect_uri`, at redirect time.**
  [构造网页授权链接 · 91022](https://developer.work.weixin.qq.com/document/path/91022)
  specifies `redirect_uri`, and the failure mode reported consistently across
  third-party write-ups is the string *"redirect_uri需使用应用可信域名"* — raised by
  `oauth2/authorize`, i.e. by a WeCom endpoint we would have to call on purpose.
  **[widely-reported]** for the exact error string; **[documented]** that the field
  governs OAuth at all.
- **Nothing in the WeCom developer documentation conditions rendering an arbitrary URL
  on it.** I searched the FAQ, the JS-SDK guide and the OAuth guide; the trusted domain
  appears only in JSAPI and `redirect_uri` contexts. **[documented as absence]** —
  labelled honestly, since absence of a rule is weaker than a stated rule.

### 1.2 The FAQ proves an unqualified domain opens

This is the load-bearing leg, and it is positive rather than negative evidence.
[FAQ · 90315](https://developer.work.weixin.qq.com/document/path/90315), question
*打开页面提示"防欺诈盗号，请勿支付或输入账号密码"*, verbatim:

> 满足以下几个条件，在微信打开页面可以去除该安全风险提示：
> - 企业已经认证通过。
> - 访问页面的域名需经过ICP备案。ICP备案可通过工业和信息化部ICP/IP地址/域名信息备案管理系统查询。
> - 在管理端将页面域名设置为应用的可信域名。

Read it precisely. Three conditions — verified enterprise, ICP filing, trusted domain —
and what they buy is the **removal of a warning**. Not access. **A page satisfying none
of the three still opens; otherwise there would be no page on which to paint the
banner.** The trusted domain is, in this sentence, a cosmetic upgrade. **[documented]**

That is the whole answer. Ticket 06's ICP wall blocks OAuth and JSAPI. It does not block
a link.

### 1.3 The only two documented ways a link fails to open

Both are in the same FAQ, and neither is a filing gate:

- *访问链接提示"将要访问 URL"* — **[documented]**:
  > 被封的原因是由于此域名存放了违规的一些内容。请自行清理违规的内容，之后在拦截提示的页面上"申请恢复访问"即可。

  A **content-based domain ban** with a self-service appeal. Reputational, not
  administrative, and it applies to any domain — including one with a perfect ICP filing.
- *企业微信打开页面提示"请在微信客户端打开链接"* — **[documented]**:
  > 企业微信不支持打开需要带微信身份的链接。包括几种情况：访问链接为oauth2链接，appid填写为公众号appid […] 公众平台发布的文章，点击"阅读原文"

  Fires only for links carrying a **consumer WeChat** identity — a 公众号 `appid` in an
  oauth2 URL, or an MP article. Our reminder links are plain `https://` app URLs. Not us.

A third FAQ entry, *应用链接无法打开、打开空白*, points at network reachability and
**expired HTTPS certificates**. Vercel renews automatically; noted only because it is the
one operational thing on the list that could ever bite. **[documented]**

### 1.4 The cost that is not zero — an anti-fraud banner over a password field

> **MEASURED 2026-08-13 by ticket 18 ([#19](https://github.com/Mikepeerawit-com/tender-tracker/issues/19)) — L1: there is no banner.** The probe page opened in the WeCom iOS webview with nothing above it and nothing below it. **This whole section's cost is zero**, and the reason is the trap it flagged itself: the FAQ says *在微信打开页面* and this section inferred it onto 企业微信 anyway. The banner is consumer 微信 behaviour. Everything below stands as a record of the inference and why it was wrong to make; the conclusion does not.

This is the finding worth carrying forward, and it is uncomfortable.

The banner in §1.2 reads **防欺诈盗号，请勿支付或输入账号密码** — *"Guard against fraud
and account theft; do not pay or enter your account password."* ADR-0006 ships
**email/password as the permanent floor**. The first screen a reminder tap lands on, for
a user whose session has lapsed, is a form asking for exactly the thing the banner says
not to type.

**And for this org the banner cannot be removed.** All three conditions must hold:

| Condition | This org |
|---|---|
| 企业已经认证通过 (verified enterprise) | **Ruled out of scope** by the map — RMB 300+, days–weeks, on an entity that already failed WeCom's filing check |
| ICP 备案 on the page domain | **Unobtainable** — ticket 06 §8; needs a mainland entity *and* mainland hosting |
| Trusted domain name configured | **Unobtainable** — same wall, and it depends on the ICP filing anyway |

So if it appears, it is **permanent**. **[inferred]** — the inference is only that
"cannot satisfy the conditions" implies "cannot remove the banner", which the FAQ states
as an if-and-only-if in the removal direction.

**What is genuinely unsettled is whether it fires in 企业微信 at all.** The FAQ is a
*WeCom* developer document, but its answer says *在微信打开页面* — "opening the page in
WeChat". WeCom docs use 微信 loosely for both products; this map has already been burnt
once by conflating WeCom and WeChat surfaces. **[inferred]** → **live check L1.**

**This does not change the verdict.** A warning banner above a working page is a
cosmetic cost, not a dead entry path. It is worth knowing before someone spends a day
trying to configure it away.

---

## 2. What the webview actually is

**iOS — `WKWebView`.** App Store rules mandate WebKit for embedded web content, and the
[FAQ 90315](https://developer.work.weixin.qq.com/document/path/90315) UA sample is a
plain iOS WebKit string with a `wxwork/` token appended. **[documented]**

> `Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_2 like Mac OS X) AppleWebKit/603.2.4 (KHTML, like Gecko) Mobile/14F89 wxwork/2.2.0 MicroMessenger/6.3.2`

**Android — a Tencent engine, generation unknown.** The FAQ's Android sample is
unambiguous about *what it was*: **[documented]**

> `Mozilla/5.0 (Linux; Android 7.1.2; g3ds Build/NJH47F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/53.0.2785.49 Mobile MQQBrowser/6.2 TBS/043508 Safari/537.36 wxwork/2.2.0 MicroMessenger/6.3.22`

`MQQBrowser/6.2 TBS/043508` is **Tencent X5 / TBS**, not the system WebView — a separate
renderer with its own update channel and its own version lag.

**But that sample is roughly nine years old.** Android 7.1.2, `Chrome/53`,
`MicroMessenger/6.3.22`. In the meantime consumer WeChat moved off X5 onto **XWeb**, a
newer Chromium-based engine that reports itself as `XWEB/…` alongside a modern
`Chrome/1xx` token. **[widely-reported]** Whether WeCom's Android client in 2026 ships
X5, XWeb, or the system WebView is **[inferred]** at best — I found no vendor statement.
→ **live check L2.**

**Why this is not academic.** The engine generation decides whether
`createImageBitmap(blob, {resizeWidth})`, `canvas.toBlob`, `fetch` with `PUT`, and
`File`/`Blob` behave as they do in Chrome Android. A `Chrome/53` renderer would fail
ticket 03's compression pipeline outright; a `Chrome/1xx` one is unremarkable. One
`navigator.userAgent` readout settles it, and the same readout settles nothing else —
which is why it is folded into a single probe page in §7.

---

## 3. Storage and cookies — the highest-value answer, and it is not the one the ticket expected

The ticket asked whether the webview partitions or discards storage. It does not. The
threat is somewhere else entirely, it is documented, and **it applies to Mobile Safari
exactly as much as to WeCom** — so it is not a webview-compatibility footnote, it is a
correction to ADR-0006.

### 3.1 Both platforms default to persistent, and the defaults are the right ones

**iOS.** Apple, on `WKWebsiteDataStore`: **[documented]**
> By default, [`WKWebViewConfiguration`] uses the default data store returned by the
> `default()` method, which saves website data persistently to disk. To implement
> private browsing, create a nonpersistent data store using the `nonPersistent()`
> method instead.

`default()` — *"Returns the default data store, which stores data persistently to disk."*
Ephemeral storage is an explicit opt-in, and there is no reason for a chat client to opt
in: WeCom's own H5 apps would break. **[inferred]** that WeCom uses the default store.

**Android.** `CookieManager.flush()` — *"Ensures all cookies currently accessible through
the getCookie API are written to persistent storage."* — so persistence is the model,
with an explicit flush API. `localStorage` is behind
`WebSettings.setDomStorageEnabled()`, whose *"default value is `false`"*, as is
`setJavaScriptEnabled()`. **[documented]** Both are self-evidently on in WeCom — its own
JS-SDK product would not function otherwise. **[inferred]**

Third-party cookies: Android defaults to **disallowing** them for apps targeting
Lollipop+ **[documented]**, and iOS blocks them outright under ITP. Irrelevant to us —
the app session is first-party.

**Verdict on the ticket's actual question: an app restart does not clear the session.**
No documented partitioning, no ephemeral store, no evidence of anything unusual.
**[inferred from documented platform defaults]** → confirmed cheaply by **live check L3**.

### 3.2 The real threat: WebKit's seven-day cap on script-writable storage

WebKit, [Tracking Prevention](https://webkit.org/tracking-prevention/): **[documented]**
> ITP deletes all cookies created in JavaScript and all other script-writeable storage
> after 7 days of no user interaction with the website.

[Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)
names the capped set and the trigger: **[documented]**
> Indexed DB, LocalStorage, Media keys, SessionStorage, Service Worker registrations and cache

> after seven days of Safari use without user interaction on the site

And what counts: *"User interaction is a user click, tap, or keyboard entry on a website
… Scrolling is not considered user interaction."* The only stated exemption is web apps
added to the home screen — **which this map ruled out of scope** along with the rest of
PWA behaviour.

**ITP is on by default in `WKWebView` from iOS 14.** **[widely-reported]** — the claim
traces to Apple's WWDC 2020 WKWebView session (via
[cordova-ios#922](https://github.com/apache/cordova-ios/issues/922)); I could not reach a
quotable Apple sentence, so it is labelled accordingly rather than asserted.

**Corroboration from Tencent's own developer community**, where a thread is titled
plainly *"H5 localstorage和cookie过段时间就会被清除"* — H5 localStorage and cookies get
cleared after a while — with reports clustering at **5–7 days**. **[widely-reported]**,
and it is user reporting on a vendor-operated forum, not a vendor statement. It is the
right number in the right place, which is what corroboration is for.

### 3.3 The collision with ADR-0006, stated plainly

- ADR-0006 ships **30-day sessions with no idle timeout**, on the explicit reasoning that
  re-login friction is not worth it for under 10 trusted users.
- `supabase-js` stores its session in **`localStorage`** by default.
- `localStorage` is in the capped set. Seven idle days deletes it.
- The usage pattern this whole map designs for is **reminder-driven** — someone taps a
  link when a deadline approaches. That is precisely the sparse, bursty pattern that
  spends most of its life outside a 7-day window.

**The 30 days are notional on iOS.** The effective ceiling is seven days of not opening
the app. **And this is not about WeCom** — Mobile Safari, one of the two browsers the map
already promised, applies the identical rule.

### 3.4 The fix is cheap and belongs in `buildspec_2`

The cap targets **script-writable** storage. A session carried in an HTTP `Set-Cookie`
cookie written by the server is not script-writable and is not in the capped list.
`@supabase/ssr` exists to do exactly this — server-set, `HttpOnly`, refreshed server-side.

**So: store the Supabase session in server-set cookies, not `localStorage`.**

Honesty about the label: WebKit's post enumerates what *is* capped and never says
server-set first-party cookies are exempt. The exemption follows from the category name
("script-writable") and from the fact that ITP 2.1 handled JS-set cookies separately from
`Set-Cookie` ones. **[inferred]** — a standard and well-worn inference, but an inference,
and worth one line in the live check (**L3b**) since we will be on the phone anyway.

### 3.5 Two smaller storage facts

- **Quota is smaller in a non-browser app.** WebKit's
  [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/):
  *"For a browser app, the origin quota is up to 60% of the total disk space. For other
  apps, the origin quota is up to 15% of the total disk space."* WeCom is an "other app".
  **[documented]** — irrelevant at our volume (a session token and some cached JS), but it
  rules out any future plan to cache photos client-side inside the webview.
- **The user can wipe it manually**: WeCom → Me → General → Storage → Clear Cache.
  **[widely-reported]** A support instruction, not a scheduled behaviour. Not a design
  constraint; just the reason a session can vanish with no seven days having passed.

---

## 4. Camera capture — a documented asymmetry between the two platforms

iOS and Android sit on opposite sides of the default. This is documented on both sides
and is the single most useful thing in this section.

### 4.1 iOS — works by default, and WeCom almost certainly has not broken it

Apple's `WKUIDelegate` file-upload hook,
`webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)` — *"Displays a file
upload panel."* — carries this availability: **macOS 10.12+**, and **iOS / iPadOS only
from 18.4**. Its description: **[documented]**

> Implement this method to customize the upload panel. To disable file uploads, implement
> this method to return [nil].

Read the availability and the verb together. On iOS, **`WKWebView` supplies the picker
itself**; the delegate merely *customizes* or *disables* it — and until 18.4 the hook did
not exist on iOS at all, so a host app **could not** break `<input type="file">` if it
tried. On 18.4+ it *could* opt out, but that would be a deliberate regression against
WeCom's own H5 apps.

So `<input type="file" accept="image/*" capture="environment">` should raise the native
sheet (Take Photo / Photo Library / Browse) with the camera pre-selected.
**[inferred from a documented API surface]** — a strong inference, since it rests on what
the platform does rather than on what WeCom chose.

One residual: iOS aborts a camera request if the host app's `Info.plist` lacks
`NSCameraUsageDescription`. WeCom ships a QR scanner and an in-chat camera, so it has the
key. **[inferred]**

### 4.2 Android — cancelled by default, and it is WeCom's job to fix

Android's `WebChromeClient.onShowFileChooser`, verbatim: **[documented]**

> The default behavior is that WebView will cancel all file requests.

**That is the exact silent-nothing failure the ticket predicted, written in the vendor
documentation.** Unless WeCom's Android client overrides `onShowFileChooser`, tapping a
file input does nothing at all — no picker, no error, no console message.

The `capture` attribute has plumbing, but the host app must honour it.
`WebChromeClient.FileChooserParams.isCaptureEnabled()`: **[documented]**

> Returns preference for a live media captured value (e.g. Camera, Microphone). True
> indicates capture is enabled, false disabled. Use `getAcceptTypes` to determine
> suitable capture devices.

Note the word **preference**. Even a correct implementation is free to ignore it.

Whether WeCom implements this, and how well, is **[inferred]** from the absence of any
statement — but Tencent's own developer community carries a consistent run of reports
that it half-works: `accept` filters ignored, camera option missing on particular
handsets, and capture-then-return crashes on some Android 10 / MIUI builds.
**[widely-reported]** — user reports on a vendor-operated forum, spanning several years
and several client versions, which is enough to call the *class* of problem real and not
enough to predict what a 2026 client does. → **live check L4.**

### 4.3 What this means for the design, whatever the live check says

**Design the input to degrade rather than to depend.** `capture="environment"` is a
*hint* in the specification and a *preference* in Android's API. Three outcomes, and only
one of them is a problem:

| Outcome | Cost |
|---|---|
| Camera opens directly | The intended gesture. Free. |
| Falls back to the gallery/file picker | Two extra taps — leave the app, shoot, come back, pick. Acceptable. |
| **Nothing happens** | **Dead end.** Unacceptable, and invisible. |

So the add-quote screen needs a visible, always-present alternative path that does not
route through the file input — realistically the §6 banner nudging the user into their
real browser, which is the same fallback the ticket already nominated. That makes the
third outcome survivable rather than fatal, which is the test the ticket set.

---

## 5. Cross-origin upload to Supabase Storage

### 5.1 WeCom imposes nothing

I found **no CSP, no URL whitelist, and no origin restriction** on `fetch`/`XHR` from a
page in the built-in browser anywhere in the WeCom developer documentation. The only
documented network-level controls are the content-based domain ban (§1.3) and the
JS-SDK trusted domain — and §1 establishes the latter governs **JSAPI calls, not HTTP
requests the page makes**. **[documented as absence]**, labelled as such because a
missing rule is weaker evidence than a stated one.

Therefore ordinary CORS applies: preflight `OPTIONS`, then `PUT`. **[inferred]**
Mixed content is moot — every origin involved is `https`.

### 5.2 The likelier failure is on the Supabase side

Two different Supabase mechanisms are both called "signed upload URL", and only one of
them works from a browser:

- **`storage.from(bucket).createSignedUploadUrl()` + `uploadToSignedUrl()`** — the
  Storage REST API (`/storage/v1/object/upload/sign/…`), which serves permissive CORS.
  **This is the one ticket 03 meant.**
- **S3-protocol presigned URLs** (`/storage/v1/s3`) — where CORS is **not configurable**,
  unlike real S3. A run of issues says so:
  [supabase#29421](https://github.com/supabase/supabase/issues/29421) (closed, labelled
  *repro needed* / *documentation*), supabase-js#1662, storage-js#221, and discussion
  #23198. **[widely-reported]**

`buildspec_2` should **name the first by function name and forbid hand-rolling a `PUT`
against a URL assembled by hand** — the closed issue above is a developer who built the
path without the `/storage/v1` prefix and read the resulting CORS error as a platform
limitation. That is a two-hour detour waiting to happen.

### 5.3 The compression step has its own trap, and I could not source it primarily

Ticket 03 settled uploads as **client-side compressed**. On iOS/WebKit there is a
long-standing ceiling on canvas backing-store area, above which the canvas yields a blank
or black bitmap rather than throwing — commonly cited around 16.7 M pixels on older iOS.
A modern phone photo (12–48 MP) sits at or above it.

**I could not reach a WebKit or Apple primary source for the number**, so: the *number*
is unverified and the *failure mode* is **[widely-reported]** and old enough to be
folklore. Treat it as a design constraint anyway, because the mitigation is free:

- prefer `createImageBitmap(blob, { resizeWidth, resizeQuality })` over drawing the
  full-resolution image to a canvas;
- if a canvas is used, downscale in steps rather than in one draw;
- **check the output is not blank before upload** — a compressed image whose byte length
  is implausibly small, or whose pixels are uniform, is the signature. Silently uploading
  a black rectangle as a Quote Photo is worse than failing.

---

## 6. The escape hatch

### 6.1 The programmatic route is dead for this org, twice over

WeCom documents `ww.openDefaultBrowser()`
([100518](https://developer.work.weixin.qq.com/document/path/100518),
[100602](https://developer.work.weixin.qq.com/document/path/100602)) — *"uses the system
browser to open a specified URL, supporting oauth2 links"*. It is exactly the API a
detected-webview banner would want.

It is unavailable to us for two independent reasons, either sufficient: **[documented]**

1. **It is PC-only.** Supported platforms: **企业微信PC 2.3.0 及以上**. No iOS or Android
   version is listed. The one place we need it is the one place it does not exist.
2. **It is a JS-SDK call.** It requires `ww.register`, which requires a **Trusted domain
   name** — the field ticket 06 §8 proved unobtainable for this entity.

**So our page cannot push the user into Safari or Chrome. It can only ask.**

### 6.2 The manual route ~~exists~~ **does not exist on iOS**

> **MEASURED 2026-08-13 by ticket 18 ([#19](https://github.com/Mikepeerawit-com/tender-tracker/issues/19)) — L5: there is no open-in-browser action.** The ⋯ menu does not carry one. This section was **[widely-reported]** with no primary source behind it, and it is **wrong** for WeCom on iOS.
>
> **So the escape hatch is dead three ways, not two.** §6.1's two reasons kill the programmatic route; this kills the manual one. There is no route from the WeCom webview to Safari, and the product must never offer one as advice. Consequence for `buildspec_2`: **everything a reminder link leads to has to work inside the webview** — the webview is not a degraded mode with a way out, it is the delivery surface.
>
> Android is unmeasured (no device), and the two platforms differ here as everywhere else in this document. Do not assume Android matches.

Mobile WeCom opens chat links in the built-in browser by default, and the overflow (⋯)
menu carries copy-link and open-in-browser actions. **[widely-reported]** — consistent
across the WeCom developer community and general write-ups; I found no help-centre page
stating it in so many words, and the exact label and tap count differ between iOS and
Android. → **live check L5**, which is where the "is it reachable in two taps?" part of
the ticket gets its answer.

### 6.3 Detection is documented, and there is a trap in it

Both official UA samples carry a **`wxwork/<version>`** token
([FAQ 90315](https://developer.work.weixin.qq.com/document/path/90315), §2 above).
**[documented]**

```js
const inWeCom = /wxwork/i.test(navigator.userAgent);
```

**The trap: WeCom's UA also contains `MicroMessenger`.** A naive "am I in WeChat?" check
matches WeCom too. Tencent's own developer-community site ships this discriminator in its
production page JS — **[widely-reported]**, but it is Tencent's own code doing it:

```js
var isWeixin = ua.indexOf('micromessenger') !== -1 && ua.indexOf('wxwork') === -1;
```

i.e. `wxwork` **present** means WeCom, `wxwork` **absent** with `micromessenger` present
means consumer WeChat. Any detection we write must test `wxwork` first.

---

## 7. Documented fact vs. what needs a phone

### 7.1 Build on these — documented, no device required

1. **Plain link-tapping is not gated by Trusted domain name, ICP filing, or enterprise
   verification.** The notification design's entry path is intact (§1).
2. **Persistent storage is the platform default on both OSes**; the app-restart failure
   the ticket feared is not a documented behaviour anywhere (§3.1).
3. **Seven idle days deletes `localStorage` on iOS**, in Mobile Safari and in any
   `WKWebView` with ITP on. The 30-day session must not live in `localStorage` (§3.2–3.4).
4. **Android cancels file requests by default**; iOS supplies the picker itself and
   could not be broken by the host app before iOS 18.4 (§4).
5. **`ww.openDefaultBrowser` is PC-only and JS-SDK-gated** — there is no programmatic
   escape hatch on a phone, for anyone, let alone for us (§6.1).
6. **`wxwork` in the UA is the documented WeCom discriminator**, and `MicroMessenger`
   alone is not (§6.3).

### 7.2 Needs a live check — and yes, one is needed

The map's own history is the argument: ticket 02 needed 06, and 07 needed 13, each time
because WeCom did something the documentation did not say. Three of the five things this
ticket was asked about (camera, engine generation, the banner) resolve to *"WeCom's
choice, undocumented"*. That is the shape of question a phone answers in ten minutes.

**The awkwardness the map flagged — "there is no app to tap into yet" — dissolves.** None
of these checks needs the app. They need **one static HTML page on an `https` host**, and
the group robot that already works to deliver the link. Build the probe page, post its URL
into the WeCom group with the existing webhook, and tap it on a phone.

#### The task ticket, ready to lift verbatim

> **Build a one-page WeCom webview probe and run it on a phone.**
>
> Deploy a single static page to any `https` host (a Vercel preview is fine — the domain
> does **not** need to be `taihue.com`, and that is part of what is being confirmed). The
> page must render, on screen, large enough to photograph:
>
> - `navigator.userAgent`, verbatim
> - the value of `/wxwork/i.test(navigator.userAgent)`
> - a value written to `localStorage` on first load, with its write timestamp, read back
>   and displayed on every load
> - a value in a server-set `Set-Cookie` (`HttpOnly` not required for the readout; set it
>   from the server, not from JS), likewise displayed
> - `<input type="file" accept="image/*" capture="environment">` and, beside it, the
>   selected file's `name`, `type`, `size`, and natural pixel dimensions
> - a **Compress & upload** button that downscales the selected image and `PUT`s it to a
>   Supabase Storage signed upload URL, then shows the HTTP status and any CORS error
> - the compressed image rendered inline at ~200px, so a blank/black result is visible
>
> Post the URL into the WeCom group **using the existing group robot webhook** — the real
> entry path, not a pasted link — then, on a phone:
>
> | | What to tap | What to look for |
> |---|---|---|
> | **L1** | Tap the link in the robot message | Does the page open at all? **Is there a warning banner** at the top or bottom — 防欺诈盗号 or similar? Screenshot it if so. Note whether it blocks or merely warns. |
> | **L2** | Read the UA line | Does it contain `wxwork`? On Android: `TBS/`, `XWEB/`, or neither — and what `Chrome/` version? Anything below `Chrome/90` is a compatibility problem for the compression step. |
> | **L3** | Note the `localStorage` timestamp. **Force-quit WeCom** (swipe it away), reopen, re-tap the link | Same timestamp = persisted. Missing or new = the store is ephemeral, and ADR-0006's session model needs rethinking beyond §3.4. |
> | **L3b** | Same restart, read the cookie line | Cookie survives the restart. (The seven-day question cannot be tapped — see below.) |
> | **L4** | Tap the file input | **Camera, gallery, or nothing?** If a sheet appears, list its options verbatim. Take a photo, return, confirm name/size/dimensions appear. Note any crash on returning from the camera. |
> | **L5** | Find the overflow (⋯) menu | Is there an "open in browser" action? **How many taps from the page?** Record the exact label in English. |
> | **L6** | Tap **Compress & upload** | HTTP status. Any CORS error. **Is the inline preview a real image or a blank/black rectangle?** |
>
> Run the whole sheet on **iOS and Android** if both are available; if only one, iOS is
> the higher-value target, because §3.2's storage cap and §4.1's picker behaviour are both
> iOS-specific and iOS is where ADR-0006's session model is most exposed.
>
> **Not checkable by tapping:** the seven-day storage cap (§3.2) — it needs seven days of
> not touching the page, and it is documented well enough not to need confirming. The fix
> in §3.4 ships regardless of what the phone says.

**Estimated cost: an hour to build the page, ten minutes to run it.** It closes L1–L6, the
engine question, and the "is it reachable in two taps" part of the ticket, in one pass.

### 7.3 What `buildspec_2` should tell a builder

> **The WeCom in-app webview is a supported target and the reminder entry path works.**
> Tapping a link in a WeCom group message opens the page — no ICP filing, no Trusted
> domain name, no verified org. A permanent WeCom security banner may sit above the login
> form; it is cosmetic and cannot be removed by this org, so do not try.
>
> **Store the Supabase session in server-set cookies (`@supabase/ssr`), never in
> `localStorage`.** WebKit deletes all script-writable storage after seven days without
> user interaction, in Mobile Safari and in the WeCom webview alike. ADR-0006's 30-day
> session is otherwise a seven-day session on every iPhone.
>
> **Treat `capture="environment"` as a hint that may not fire.** Android WebView cancels
> file requests unless the host app opts in, and WeCom's implementation is reported to be
> inconsistent. Add-quote must therefore carry a visible fallback path, and the app should
> detect the webview (`/wxwork/i.test(navigator.userAgent)`) and show a one-line banner
> offering "open in your browser" — **as text, because there is no API for it**;
> `ww.openDefaultBrowser` is desktop-only and needs a trusted domain we cannot get.
>
> **Upload via `createSignedUploadUrl()` + `uploadToSignedUrl()`** from `supabase-js`.
> Do not hand-assemble a `PUT` against an S3-protocol presigned URL — Supabase does not
> let you configure CORS on that path.
>
> **Downscale with `createImageBitmap(blob, { resizeWidth })` and verify the result is not
> blank** before uploading. WebKit silently produces a blank bitmap when a canvas exceeds
> its area limit, and a 48 MP photo exceeds it.

---

## 8. Not researched

Recorded so a later session does not assume they were covered and found clean.

- **Whether WeCom's Android client honours `isCaptureEnabled()` in 2026.** No vendor
  statement exists; the community reports span years and client versions. L4 answers it
  for the handsets we actually have, which is the only answer that matters under 10 users.
- **The precise WebKit canvas area limit** (§5.3). Not sourced primarily; the mitigation
  does not depend on the number.
- **Whether server-set first-party cookies are truly exempt from the seven-day cap**
  (§3.4). Inferred from the category name. L3b gets a restart-level datapoint; the
  seven-day version is not tappable.
- **PC WeCom.** The map's mobile-parity scope is about phones, and `ww.openDefaultBrowser`
  is the only PC-specific thing that surfaced. If desktop WeCom ever becomes a promised
  target, the debug hooks are documented — `ctrl+alt+shift+D` on Windows,
  `command+shift+control+D` on macOS ([FAQ 90315](https://developer.work.weixin.qq.com/document/path/90315)) —
  and they would make a PC probe trivial.
- **Service workers and any caching layer inside the webview.** Out of scope with PWA;
  noted only because service worker registrations are in ITP's capped set (§3.2), so
  anything built on them would inherit the same seven-day clock.

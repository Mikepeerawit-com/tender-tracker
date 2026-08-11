# 07 — What authentication ships in v1

Type: grilling
Status: open
Blocked by: 02, 03, 06

## Question

With the real integration path for WeCom login known (02), hosting constraints known (03), and the WeCom app actually registered (06), decide what ships at launch.

The standing posture from charting is **email/password first, WeCom login as fast-follow**. Confirm or overturn it against the evidence — if 02 comes back saying the integration is a two-day job rather than a two-week one, the posture should change.

Decide:

1. **What's in v1.** Email/password only, both, or WeCom-only. Note that WeCom-only is not obviously wrong here — it removes password management entirely for a workforce that already lives in WeCom.
2. **How the first accounts exist.** There is no admin UI in MVP ("manual via Supabase dashboard"). Concretely: how does colleague #4 get an account on a Tuesday? If the answer is "you create it by hand," confirm that survives 10 people.
3. **Does WeCom membership stay the org-membership check?** `buildspec_1` claims "being in Taihue's WeCom implies being a Taihue user." That's an elegant claim — verify it survives 02's findings, and decide what happens to a user who *leaves* the WeCom org (does their app access die, and does anything actually check?).
4. **Account linking.** If both methods ship, one human with an email account and a WeCom identity must not become two rows. Decide the identity model now — `users` needs whatever columns link an external WeCom `userid` to an account, and this is painful to retrofit once there is real data.
5. **What "fast-follow" commits you to.** If WeCom login is deferred, name the schema affordances v1 must include so the follow-up isn't a migration.

Read the resolutions of 02, 03 and 06 in full before starting — this ticket is the point where three research threads have to agree.

---

## Sharpened after ticket 02 resolved

02 came back with a harder answer than expected, which changes what this ticket must decide. Two additions:

**6. Is WeCom login worth its administrative price at all?** This is now the central question, and it is a *business* judgement, not a technical one. The engineering is 1–2 days. But it requires an **ICP-filed domain under Taihue's own entity** (weeks) and an **已验证/认证 WeCom org** (days–weeks, RMB 300+), and both bind every implementation option including the cheap fallback. Against that: email/password costs nothing and works today. Honest options —
   - pay the administrative cost, because password-free login for a WeCom-native workforce is worth it;
   - **cut WeCom login entirely** and keep WeCom only for the notification robot (which needs no trusted domain);
   - defer until Taihue independently needs an ICP-filed domain for other reasons.

   Ticket 06's answers to checks 1 and 2 decide this. If Taihue is already 已认证 *and* holds a 备案'd domain, the price is near zero and this becomes easy. If neither, "fast-follow" is optimistic framing for "a quarter away."

**7. Shim or `generateLink` fallback?** If WeCom login survives (6), pick the mechanism: the WeCom→OIDC shim (real `auth.identities` row, unlocks `signInWithIdToken` later, ~1–2 days, needs its own hosted origin) versus `admin.createUser` + `generateLink` + `verifyOtp` with a synthetic email (~0.5 day, no identities row, and you must lock the synthetic email domain against self-service login). Note the fallback does **not** dodge the domain/ICP problem.

**Revised again after ticket 03.** Question 6 above is now sharper than "is it worth the price" — 03 found ICP filing requires a mainland entity **and** mainland-hosted servers, so an ICP-filed domain and Vercel are mutually exclusive. The likely answer is that **WeCom web-OAuth login is not purchasable at any reasonable price**, and the real decision becomes: confirm it's dead (via 06's trusted-domain test), then design the auth around its absence. If 06 comes back "rejected on 备案 grounds," this ticket resolves quickly — email/password, `wecom_userid` as an optional linked field for later, and WeCom retained purely as a notification channel. Do **not** let this ticket drift into re-platforming to mainland China; that is a company-strategy decision, and it belongs out of scope for this map.

Also revise question 4 (account linking) with 02's finding: **WeCom yields no email**, so linking cannot key on it. `users` needs a `wecom_userid` column and a deliberate answer for what happens when the same human arrives via both paths.

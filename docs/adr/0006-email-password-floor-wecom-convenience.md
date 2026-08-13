# Email/password is the floor; WeCom QR login is a convenience layer

> **Superseded in part by [ADR-0008](0008-wecom-qr-login-deferred-from-v1.md) (ticket 11).** QR login is **deferred out of v1** — email/password ships alone. Everything else here stands: invite-only accounts, link-while-signed-in, no prefill, `is_org_admin`, soft-disable, 30-day sessions, Resend. `users.wecom_userid` also stays, but for reminder targeting rather than login.

`buildspec_1` planned WeCom login as a custom OAuth 2.0 provider and claimed it would double as the org-membership check. Tickets 02, 03 and 06 dismantled the mechanism but not the goal. WeCom **web OAuth** — both the in-client `oauth2/authorize` flow and the QR/SSO flow — binds `redirect_uri` to the app's **Trusted domain name**, which the WeCom console rejects unless the domain's ICP **filing entity** matches the company entity. An ICP filing needs a mainland-registered entity *and* mainland-hosted servers, so a Thailand-registered company cannot obtain one without becoming a different company. Ticket 06 observed the rejection directly.

What survives is narrower and still valuable: WeCom as a **faster way to log in**, not as the source of identity, and not as the way accounts come into existence.

## Decisions

- **Email/password ships first and stays permanently.** It is the floor. Every user can always log in with it, whatever state WeCom, the app's egress IP, or the WeCom console is in. "Nobody can log in" is not a recoverable position for the tool the business runs tenders on.
- **WeCom QR login ships as a convenience path**, using the **Authorized callback domain** field under **WeCom Authorized Login** — a *different* console field from the **Trusted domain name** that ticket 06 got rejected on. **Ticket 13 confirmed it carries no filing gate.** It is viable but not free (see the measurement below), and whether it makes the v1 cut is now ticket 11's call.
- **Accounts are created by invitation, never by scanning.** The Org Admin invites by email; the invitee sets a password. A QR scan whose `wecom_userid` matches no row does **not** create an account — it directs the person to sign up. WeCom membership is not, by itself, an entry ticket.
- **WeCom is linked while logged in, never matched at login.** A signed-in user hits "Connect WeCom", scans once, and their `wecom_userid` is written to their existing row. `users.wecom_userid` is nullable and `UNIQUE`. There is no attempt to match an incoming WeCom identity to an existing account by name or any other guess.
- **No prefill in v1.** QR login yields a `userid` and nothing else. Name requires the `user/get` business API (a whitelisted IP); mobile and email additionally require a **verified (已验证/认证)** org. Prefilling a name the user can type in three seconds does not justify either.
- **`users.is_org_admin` boolean, true for exactly one row** — not a `role` enum. Inviting is the only thing it gates.
- **Users are soft-disabled, never deleted** (`users.disabled_at`). A departing user owns Tenders and has entered Quotes; deleting the row would orphan the Quote history the comparison view is built on. Offboarding is a manual runbook step — nothing checks WeCom membership automatically.
- **Sessions last 30 days with no idle timeout.** Internal tool, under 10 trusted users, largely on personal phones, and everyone is already permitted to see margin. Re-login friction costs more than it buys. **Amended by ticket 17 — this only holds if the session is carried in a server-set cookie; see below.**
- **Invites are sent by email via Resend** configured as custom SMTP in Supabase. Supabase's built-in mailer is rate-limited and not for production. This is transactional sending and does **not** reopen the internal-mailbox provider question, which stays out of scope.

## The measurement — resolved by ticket 13 (2026-08-12)

Ticket 13 ([#14](https://github.com/Mikepeerawit-com/tender-tracker/issues/14)) measured all three gates. Findings: [`docs/research/13-wecom-qr-login-gates.md`](../research/13-wecom-qr-login-gates.md).

| Test | Question | Result |
|---|---|---|
| **A** | Does **Authorized callback domain** carry the filing-entity gate? | ✅ **No.** `taihue.com` saved outright — no 备案主体 rejection, no ownership file demanded |
| **B** | Is `auth/getuserinfo` exempt from **Trusted enterprise IP**? | ❌ **No.** Returns `60020`, as does every other endpoint the flow could use |
| **C** | Can Trusted enterprise IP be unlocked without an ICP filing? | ✅ **Yes**, via **Receive messages server URL** — that route carries no filing gate |

**This ADR's central argument is vindicated.** The map had written WeCom login off on ticket 06's **Trusted domain name** rejection; this ADR argued that was the wrong field. It was. QR login is available, and more broadly **no WeCom capability is permanently out of reach for this org** — the ICP wall blocks exactly one field, and there is a second door.

**The decision rule resolves to its third branch: A passes, B fails.** QR login is viable but not free:

| | |
|---|---|
| Callback endpoint w/ WeCom AES `echostr` verification | ~50–100 lines. **Inbound, so not IP-gated** — Vercel can host it |
| Fixed-IP host for WeCom-facing calls | ~$2–6/mo, and a **second deployment target** beside Vercel + Supabase |
| WeCom→OIDC shim | 1–2 days, per ticket 02 — required **only** if QR login ships |
| Unverified | Whether WeCom accepts a **cloud-provider IP** rather than rejecting it as third-party. Untestable until the callback endpoint exists |

**The ship/drop decision is deliberately not taken here.** It is a scope judgement, not a measurement, and belongs to ticket 11 ([#12](https://github.com/Mikepeerawit-com/tender-tracker/issues/12)) alongside every other v1 cut. **Nothing has been bought**, which was this rule's purpose.

The zero-cost fallback stands unchanged if ticket 11 cuts it: drop QR login and have the **group robot post the invite link into the WeCom group** — robot webhooks are confirmed exempt from IP whitelisting, ICP and domain gates, so onboarding still starts inside WeCom, in one tap.

### Two traps for whoever builds this

- **`gettoken` is exempt and returns `0`.** It makes the IP constraint look absent. Ticket 06 was misled by this once; testing only `gettoken` proves nothing. Always probe a business endpoint.
- **The published error lists are incomplete.** WeCom's `auth/getuserinfo` docs list only `40029` and `50001` — never `60020`. The IP gate sits at a layer above the endpoint and is not documented per-endpoint. Do not infer exemption from a doc page.

## The 30-day session is a 7-day session unless it lives in a cookie — ticket 17 (2026-08-13)

Ticket 17 ([#18](https://github.com/Mikepeerawit-com/tender-tracker/issues/18)) went looking at the WeCom in-app webview and found this instead. Findings: [`docs/research/17-wecom-webview.md`](../research/17-wecom-webview.md) §3.

WebKit's Tracking Prevention **deletes all script-writable storage after 7 days of no user interaction with the site** — `localStorage` is named in the capped set, and scrolling does not count as interaction. `supabase-js` stores its session in `localStorage` by default. This app's usage is reminder-driven and therefore sparse by design: someone taps a link when a deadline approaches, which is exactly the pattern that spends most of its life outside a 7-day window.

**So the decision above is amended: store the Supabase session in server-set cookies (`@supabase/ssr`), never in `localStorage`.** Server-set cookies are not script-writable and are not in the capped set.

Two things worth stating plainly, because both are easy to misfile:

- **This is not a WeCom problem.** Mobile Safari — one of the two browsers this project already promised — applies the identical rule. The webview was where it surfaced, not where it lives.
- **The exemption for server-set cookies is [inferred](../research/17-wecom-webview.md#34-the-fix-is-cheap-and-belongs-in-buildspec_2), not quoted.** WebKit enumerates what is capped and never states the exemption; it follows from the category name. The inference is standard, but it is an inference.

The only stated exemption to the 7-day cap is a web app added to the home screen — which this map ruled **out of scope** along with the rest of PWA behaviour, so it is not available as a workaround.

## Consequences

- `buildspec_1`'s "being in Taihue's WeCom implies being a Taihue user" is **dropped**, not reimplemented. Nothing checks WeCom membership, at login or afterwards.
- `buildspec_1`'s `users` row of `id, org_id, name, email, role (admin/member), created_at` becomes `… name, email, wecom_userid (nullable, unique), is_org_admin, disabled_at, created_at`. The `role` enum is gone.
- The app sends exactly one kind of email — the invite. There is no password-reset story beyond the Org Admin resetting it in the Supabase dashboard, which is acceptable under 10 users and keeps the email surface at one template.
- Notifications are unaffected. Reminders stay on the group robot per [ADR-0005](0005-reminder-delivery-semantics.md); private per-user `message/send` reminders were considered and deferred, because the robot is the least-coupled component on the map — no IP whitelist, no console gates — and it already works.
- If a fixed IP is ever bought for QR login, private reminders become a small change, since both need `wecom_userid` on the user row and it will already be there.
- ~~**A permanent WeCom security banner may sit directly above the login form**, and it says "do not pay or enter your account password". Ticket 17 found the three conditions that remove it — verified org, ICP filing, Trusted domain name — are the same three this org cannot obtain, so if it appears it cannot be removed. Do not spend time trying. Whether it fires inside 企业微信 (as opposed to consumer 微信) is unconfirmed and is **L1** on the live probe.~~ **Measured by ticket 18 ([#19](https://github.com/Mikepeerawit-com/tender-tracker/issues/19)): there is no banner.** The page opens clean in the WeCom iOS webview — nothing above it, nothing below it. The banner is a consumer-微信 behaviour, and ticket 17 inferred it onto 企业微信 from an FAQ that says 在微信打开页面; the WeChat/WeCom conflation this map has been burnt by before caught its own research this time. **The email/password floor lands on an unqualified page with no warning over the form**, and the three unobtainable conditions cost nothing after all.
- **There is no way out of the WeCom webview into Safari, and the login screen must assume it.** Ticket 18 also killed the manual escape hatch (see below), so a user whose session has lapsed cannot be told to "open this in your browser" — the login form has to work where it lands.

# Email/password is the floor; WeCom QR login is a convenience layer

`buildspec_1` planned WeCom login as a custom OAuth 2.0 provider and claimed it would double as the org-membership check. Tickets 02, 03 and 06 dismantled the mechanism but not the goal. WeCom **web OAuth** — both the in-client `oauth2/authorize` flow and the QR/SSO flow — binds `redirect_uri` to the app's **Trusted domain name**, which the WeCom console rejects unless the domain's ICP **filing entity** matches the company entity. An ICP filing needs a mainland-registered entity *and* mainland-hosted servers, so a Thailand-registered company cannot obtain one without becoming a different company. Ticket 06 observed the rejection directly.

What survives is narrower and still valuable: WeCom as a **faster way to log in**, not as the source of identity, and not as the way accounts come into existence.

## Decisions

- **Email/password ships first and stays permanently.** It is the floor. Every user can always log in with it, whatever state WeCom, the app's egress IP, or the WeCom console is in. "Nobody can log in" is not a recoverable position for the tool the business runs tenders on.
- **WeCom QR login ships as a convenience path**, using the **Authorized callback domain** field under **WeCom Authorized Login** — a *different* console field from the **Trusted domain name** that ticket 06 got rejected on, and one nothing has yet tested. Whether it carries the same filing gate is the open measurement below.
- **Accounts are created by invitation, never by scanning.** The Org Admin invites by email; the invitee sets a password. A QR scan whose `wecom_userid` matches no row does **not** create an account — it directs the person to sign up. WeCom membership is not, by itself, an entry ticket.
- **WeCom is linked while logged in, never matched at login.** A signed-in user hits "Connect WeCom", scans once, and their `wecom_userid` is written to their existing row. `users.wecom_userid` is nullable and `UNIQUE`. There is no attempt to match an incoming WeCom identity to an existing account by name or any other guess.
- **No prefill in v1.** QR login yields a `userid` and nothing else. Name requires the `user/get` business API (a whitelisted IP); mobile and email additionally require a **verified (已验证/认证)** org. Prefilling a name the user can type in three seconds does not justify either.
- **`users.is_org_admin` boolean, true for exactly one row** — not a `role` enum. Inviting is the only thing it gates.
- **Users are soft-disabled, never deleted** (`users.disabled_at`). A departing user owns Tenders and has entered Quotes; deleting the row would orphan the Quote history the comparison view is built on. Offboarding is a manual runbook step — nothing checks WeCom membership automatically.
- **Sessions last 30 days with no idle timeout.** Internal tool, under 10 trusted users, largely on personal phones, and everyone is already permitted to see margin. Re-login friction costs more than it buys.
- **Invites are sent by email via Resend** configured as custom SMTP in Supabase. Supabase's built-in mailer is rate-limited and not for production. This is transactional sending and does **not** reopen the internal-mailbox provider question, which stays out of scope.

## The open measurement

WeCom QR login rests on two unverified claims, both cheap to test on the console:

- **Test A** — does **Authorized callback domain** accept a domain, or reject it on filing entity like **Trusted domain name** did?
- **Test B** — is `auth/getuserinfo` exempt from **Trusted enterprise IP**, as `gettoken` is? Ticket 06 measured `gettoken` → `0` but `department/list`, `user/simplelist` and `message/send` → **60020**. The official `auth/getuserinfo` doc lists only `40029` and `50001`, never `60020` — so exemption is plausible but unproven.

**Decision rule, so no money is spent before the measurement:**

- Both pass → QR login ships at **zero** additional cost.
- A fails → QR login is not available; email/password only.
- B fails → the code→userid exchange needs a fixed egress IP, which Vercel cannot provide. Take a **Fly.io dedicated IPv4** (~$2/mo, ~50-line proxy) *if* judged worth it at that point. The documented zero-cost fallback is to drop QR login and have the **group robot post the invite link into the WeCom group** — robot webhooks are confirmed exempt from IP whitelisting, ICP and domain gates, so onboarding still starts inside WeCom, in one tap.

## Consequences

- `buildspec_1`'s "being in Taihue's WeCom implies being a Taihue user" is **dropped**, not reimplemented. Nothing checks WeCom membership, at login or afterwards.
- `buildspec_1`'s `users` row of `id, org_id, name, email, role (admin/member), created_at` becomes `… name, email, wecom_userid (nullable, unique), is_org_admin, disabled_at, created_at`. The `role` enum is gone.
- The app sends exactly one kind of email — the invite. There is no password-reset story beyond the Org Admin resetting it in the Supabase dashboard, which is acceptable under 10 users and keeps the email surface at one template.
- Notifications are unaffected. Reminders stay on the group robot per [ADR-0005](0005-reminder-delivery-semantics.md); private per-user `message/send` reminders were considered and deferred, because the robot is the least-coupled component on the map — no IP whitelist, no console gates — and it already works.
- If a fixed IP is ever bought for QR login, private reminders become a small change, since both need `wecom_userid` on the user row and it will already be there.

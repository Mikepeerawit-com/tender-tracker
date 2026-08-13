# WeCom QR login is measured, viable, and deferred out of v1

**Status:** accepted. Supersedes the QR-login half of [ADR-0006](0006-email-password-floor-wecom-convenience.md); the rest of ADR-0006 stands unchanged.

Tickets 02, 06 and 13 spent most of this map's effort establishing that WeCom QR login is *possible* for a Thailand-registered company — against an ICP filing wall that initially looked fatal. ADR-0006 concluded both auth paths ship in v1. Ticket 11's scope cut reverses that: **email/password ships alone, and QR login is deferred to v1.1.** The capability is proven, not abandoned.

## Why the reversal

ADR-0006 deliberately left the ship/drop call to ticket 11, because it is a scope judgement rather than a measurement, and because nothing had been bought. Applying ticket 11's own test — *does removing it stop the first real tender being tracked end to end?* — QR login fails plainly. It saves under 10 users from typing a password, on 30-day sessions.

Against that:

- **A second deployment target.** The `code` → `wecom_userid` exchange is IP-gated (`60020`) and Vercel has no stable egress IP, so QR login requires a fixed-IP host (~$2–6/mo) beside Vercel and Supabase — a third piece of infrastructure to deploy, monitor and hold secrets for, in a project whose appeal is that there are only two.
- **1–2 days of build** for the WeCom→OIDC shim, plus the callback endpoint.
- **An unverified risk.** Nobody has confirmed WeCom accepts a *cloud-provider* IP rather than rejecting it as third-party, and it is untestable until the callback endpoint exists.
- **A silent failure mode forever after.** If the whitelisted IP ever changes, login reverts to `60020` with no warning.

The zero-cost fallback from ADR-0006 stands and is now the shipping design: the **group robot posts the invite link into the WeCom group**. Robot webhooks are confirmed exempt from IP whitelisting, ICP and domain gates, so onboarding still starts inside WeCom in one tap.

## What this does *not* undo

`users.wecom_userid` **stays in the v1 schema** — for a different reason than ADR-0006 gave it. Ticket 11 ships targeted reminders, which need `mentioned_list` targeting, and ticket 14 established the userid is readable from **Contacts → member → Account** with no API call. So the column is populated by an Org Admin hand-copying it once per user, and v1.1's QR login will find it already there and already populated.

Ticket 13's measurements are not wasted and must not be re-run: **Authorized callback domain** carries no filing gate, and **Trusted enterprise IP** can be unlocked via **Receive messages server URL**. See [`docs/research/13-wecom-qr-login-gates.md`](../research/13-wecom-qr-login-gates.md). v1.1 is a build, not another investigation.

## Consequences

- The **fixed-IP VM leaves the v1 running-cost floor entirely** — it was only ever needed for QR login.
- v1 has exactly one WeCom integration: an **outbound group-robot webhook**. No inbound endpoint, no IP whitelist, no OIDC shim, no console gate on the critical path.
- Private per-user `message/send` reminders remain deferred for the same reason they always were — they need the same fixed IP.
- Reversing this is cheap and localised, which is why it is a deferral rather than a rejection.

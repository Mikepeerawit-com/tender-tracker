# What the group robot may say, and how the seam is shaped

> **Partly superseded by [ADR-0013](0013-group-robot-webhook-is-org-data.md).** The webhook is no longer an environment variable — it is per-org data an Org Admin sets in the app. Every other decision below stands.

Ticket 32 ([#32](https://github.com/Mikepeerawit-com/tender-tracker/issues/32)) builds the one outbound integration in v1: a plain HTTPS POST to the WeCom group-robot webhook. [ADR-0005](0005-reminder-delivery-semantics.md) already settles the *delivery* semantics — pace ~3s apart, never mark `sent` on a non-zero errcode, mention by `mentioned_list` rather than `mentioned_mobile_list`, and `errcode 0` means accepted rather than notified. This ADR settles what remained open: **what the messages may contain, what language they are in, and where the boundary sits.**

## Decisions

- **Messages are financially silent.** No price, no margin, no landed cost, and **no supplier name**. A message names the Tender, the client, the Tender Item and the Outcome, and @s the person: *"Tender #1042 — Bangkok Hospital — 'PICC catheter 4Fr' — WON @Somchai"*.
- **Message text is hardcoded Simplified Chinese, outside `next-intl`.** It is not switchable and there is no English variant.
- **Only `text` is ever sent.** No markdown message type, in any message, mentioning anyone or not.
- **The outbound boundary is injected, not global.** `sendGroupMessages(messages, boundary)` takes its `fetch` and its `wait` as arguments; tests pass stubs.
- **A `wecom_userid` is trusted only after a human confirms receipt.** The Org Admin sends a test @mention from the People screen, and the colleague replies. This is the only verification that exists.

## Why financial silence

The WeCom group is a **broadcast surface whose membership nobody in this app controls**. People are added to work groups routinely, and the app is never told. Every access rule the product has — RLS, the org boundary, Org Admin — stops at the webhook.

Supplier identity is the sharper half. It is commercially sensitive in a way a price is not: a supplier name reaching a client, or a colleague who later leaves for a competitor, is a commercial problem rather than a bug report. Margin is the same class of disclosure pointed inward.

This is not a rule about tone; it is what makes the group safe to post to at all. **The mention is a pointer, not a report** — its job is to drive somebody into the app, where the financial detail lives behind the access rules that actually bind.

Enforced in `src/lib/wecom/messages.test.ts`, which calls **every exported message builder** by introspection with a fixture salted with price, selling price, landed cost, margin and supplier fields, and asserts none of them — nor any currency symbol — reaches the content. A builder added for the reminders (#33), the outcome news (#34) or the Digest (#35) is covered the day it is written, with nobody remembering to come back.

## Why the text sits outside the i18n system

[ADR-0011](0011-locale-is-not-in-the-url.md) puts every screen behind `next-intl` with both locales complete at launch, and `messages.test.ts` fails the build if one drifts. The robot's text is deliberately not part of that, and the reason is not effort.

**These messages have no reader whose locale could select between two versions.** They are broadcast into one group and rendered once, for everyone in it. A translated variant would still have to pick a single language per message, and the only thing available to pick it *by* is whoever the message happens to be **about** — so the Digest's language would swing with whose Tender sorted first. Half-inside the i18n system is worse than outside it: it looks like a setting, and it obeys nobody.

This is also the app's highest-volume output and it is not a screen. Putting it in the message catalogue would put the most-sent strings in the project under a parity test that cannot say anything true about them.

## Why the boundary is injected rather than stubbed globally

`vitest.config.mts` names exactly two mocked outbound boundaries in this project — the WeCom robot webhook and the Frankfurter rate fetch — against a test seam that otherwise runs on real Postgres.

Stubbing `fetch` globally would be the obvious way to stand at this one, and it does not work here: the send path is reached from server actions that also talk to Postgres over HTTP, so a global stub takes `supabase-js` down with it. `sendTestMention` is exactly that shape — it reads the target's `wecom_userid` from the database and *then* posts. So the boundary is a parameter, defaulting to `globalThis.fetch`.

Pacing is injected for the same reason the run instant is ([ADR-0010](0010-injected-run-instant.md)): a three-message batch that waits ~3s between sends costs a test six real seconds, and a rule that expensive to assert stops being asserted.

## Consequences

- **No "delivered", "notified" or "sent to" indicator may be built anywhere in the UI**, and no such column may be added to the schema. `errcode 0` cannot support one: a nonexistent userid and an empty string are both accepted silently and notify nobody ([ticket 14](../research/14-wecom-mention-targeting.md)). The success wording on the test-mention button says the message was *posted* and asks the human to confirm — that phrasing is the decision, not a UI detail.
- **A message that would need a price is a message that should be a link.** #33–#35 inherit this; if a notification seems to require a figure to be useful, the notification is wrong, not the rule.
- **`mentioned_mobile_list` appears nowhere in `src/`**, guarded by a source scan in `src/lib/auth/conventions.test.ts`. A mis-formatted mobile fails *systematically* — the natural Thai local format binds for nobody — so one mistake makes the whole org unreachable at once, silently.
- **Pacing is per batch, not per process.** `sendGroupMessages` waits ~3s between the messages of one call and keeps no state across calls, so the 20-per-minute cap is enforced *within* a batch only. That is where the risk actually lives — ADR-0005's catch-up burst is one batch, and so is the daily Digest. It is deliberately **not** a process-wide limiter: Fluid Compute reuses instances and runs several of them, so module-level state would be shared by some sends and not others, which is a false comfort rather than a cap. The residual is the Test Mention button, and it is small by construction — there is exactly one Org Admin per org (`CONTEXT.md`), and the button disables while its send is in flight, so the reachable rate is bounded by round-trip latency. Revisit this the first time a second batch caller can run concurrently with the cron.
- **An empty batch is a no-op, not a misconfiguration.** `sendGroupMessages([])` returns before reading the environment, so a cron run with nothing due does not crash a deployment for want of a webhook it was never going to use. A missing webhook still throws at the first real send, and `/api/health` is where a deployment's configuration is meant to be caught.
- **The webhook is a bearer URL.** Anyone holding it can post to the group. It is server-side only, never `NEXT_PUBLIC_`, and a deployment without it throws at the first send rather than posting nowhere and reporting success.

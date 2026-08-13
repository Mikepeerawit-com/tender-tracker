# Ticket 14 — group-robot mention targeting: userid beats mobile

Resolves [#15](https://github.com/Mikepeerawit-com/tender-tracker/issues/15). Measured
2026-08-13 against the existing group robot, webhook in `.env` → `WECOM_ROBOT_WEBHOOK`.
Script: `.scratch/tender-tracker-mvp/test-mentioned-list.sh`.

The ticket asked three questions about `mentioned_mobile_list`. Answering them surfaced
a fourth that supersedes two of them: **there is a second mention route the map never
considered**, and it is the one the WeCom docs treat as primary.

## 0. The route the map missed

The robot's `text` payload carries **two** mention lists
([docs](https://developer.work.weixin.qq.com/document/path/91770)):

| Field | Accepts |
|---|---|
| `mentioned_list` | **userid** (plus `"@all"`) |
| `mentioned_mobile_list` | mobile number (plus `"@all"`) |

The docs are explicit that mobile is the fallback: *"if the developer cannot obtain
userid, can use mentioned_mobile_list."*

Ticket 08 took the fallback, on the reasoning that a userid requires `user/list` /
`user/get`, which ticket 06 measured as **60020**-gated under Trusted enterprise IP.
That reasoning holds for the *API* and misses the console: **Contacts → member →
Account _is_ the userid**, admin-visible and admin-settable
([Modify information of a member](https://open.work.weixin.qq.com/help2/pc/14950?person_id=1)).
Under 10 users it is a one-time hand-copy. No IP gate, no fixed-IP host, no ICP filing.

## 1. Does `mentioned_list` bind? — YES

| Label | `mentioned_list` sent | errcode | Notified? |
|---|---|---|---|
| `BOGUS` | `["zzz_no_such_user_zzz"]` | 0 | ❌ no |
| `EMPTY` | `[""]` | 0 | ❌ no |
| `REAL` | `["peerawitchariyawongsiri"]` | 0 | ✅ **yes** |
| `POS2` | `["zzz_no_such_user_zzz","peerawitchariyawongsiri"]` | 0 | ✅ **yes** |

Working payload:

```json
{"msgtype":"text","text":{"content":"…","mentioned_list":["peerawitchariyawongsiri"]}}
```

## 2. Does one message mention more than one person? — SUBSTANTIVELY YES

The ticket's check 1. No second person was available, so it was measured by proxy:
`POS2` put the real userid in **position 2, behind a junk entry**, and it notified.

That eliminates the failure mode check 1 exists to catch — **a list that silently binds
only its first element**. WeCom iterates the whole list, and an unmatched entry does not
abort processing of later ones. Each element resolves independently.

**Residual, deliberately not measured:** two *distinct real humans* notified from one
message. There is no plausible mechanism by which the API binds position 2 for one user
but not another — elements resolve independently, which `POS2` demonstrates — so this is
recorded as closed rather than open. Re-test opportunistically the first time a second
member is available; it costs one message.

## 3. Invalid identifier — SILENTLY ACCEPTED (the 06 landmine is NOT route-specific)

The hoped-for result was that userids are validated, giving the runtime signal mobiles
lack. **They are not.** `BOGUS` and `EMPTY` both returned `{"errcode":0,"errmsg":"ok"}`,
delivered the message body, and notified nobody.

So `errcode 0` means **accepted**, never **notified**, on *both* routes. This is the same
silent-failure class as ADR-0005's write-once `sent` flag and 06's E.164 trap.

**What still separates the routes is blast radius, not loudness:**

- **Mobile fails systematically.** `0933555055` — the format a Thai person naturally
  types — binds for nobody. Store the natural format and the whole org is silently
  unreachable at once.
- **Userid fails per-person.** A typo drops one user. Same mode, one-hundredth the damage.

**Requirement this creates for `buildspec_2`, on whichever route ships:** an identifier
cannot be trusted because it was saved. Each one needs verifying once, by a human
confirming receipt — realistically a per-user **"send test mention"** action in the app.
There is no automated substitute; the API will never tell you.

## 4. Rate limit — COMPUTED, NOT MEASURED

The burst test was deliberately skipped rather than spam a live work group; the
documented cap is **20 messages/minute per webhook** and it was not exercised.

ADR-0005 claimed a catch-up burst "stays well within the 20-messages-per-minute cap
because notifications are already batched per Tender". That is **conditionally true, and
the condition was not written down.** "Batched per Tender (not per Item)" bounds messages
per Tender per *event*; it does not collapse across missed days, nor across the two
milestones that can fall due the same morning.

A 3-day outage over 10 open Tenders:

- **~10 messages** if batching collapses per Tender **per cron run** — comfortable.
- **up to ~60** if the send path naively loops pending reminder rows — breaches the cap.

At the volume ticket 11 assumes (~6–10 open Tenders), the collapsed form is ≤11 messages
per run including the daily Digest. Comfortable, but by construction rather than by luck.

**Requirements for `buildspec_2`:**

- Batch **per Tender per cron run** — collapse across days *and* milestones, not just Items.
- **Pace sends ~3s apart** (≈17/min) rather than firing a loop.
- **Never mark `sent` on a non-zero errcode.** Throttle behaviour is unmeasured, so treat
  any non-zero response as retryable and leave the row unsent — ADR-0005's catch-up
  semantics then recover it on the next run at no extra cost.
- `errcode 0` still does not license a "notification delivered" indicator anywhere in the UI.

## 5. Consequences for the schema

If the userid route ships:

- **`users.mobile` is no longer load-bearing** and may leave the schema entirely — with it
  goes the E.164 write-time validation rule from 06 and the storing of colleagues' personal
  phone numbers.
- **`users.wecom_userid` already exists** (nullable + unique, per ADR-0006, linked while
  signed in for QR login). Mention targeting can key on the same column — but note the two
  populate differently: ADR-0006 fills it from a QR scan, while mention targeting only needs
  an **Org Admin pasting the Account value from Contacts**. The hand-copy path works with no
  QR login at all, so **mention targeting does not depend on ticket 11's QR ship/drop call**.

## 6. Not measured

- Two distinct real humans from one message (§2 residual).
- A valid, correctly-formatted *mobile* belonging to a non-member — the ticket's original
  check 2. Superseded: the userid analogue was measured instead, and mobile is now the
  route not recommended. Reopen only if the mobile route is revived.
- The 20/min cap itself, and what WeCom returns when it is breached (§4).

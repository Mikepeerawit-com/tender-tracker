# 08 — Notification delivery and the reminder model

Type: grilling
Status: resolved
Blocked by: 06 — *unblocked in practice; the docs settled what 06 was needed for. 06 remains worth doing as empirical confirmation, but no longer gates this ticket.*

## Question

`buildspec_1` proposes a `reminders` table (`tender_id`, `days_before`, `sent`, `sent_at`) and a daily cron matching `submission_deadline - today = days_before`, delivering to an in-app bell and a WeCom group robot. The mechanism is sketched; the semantics are not.

Decide:

1. **Who is notified.** The tender owner, or everyone? A group robot posts to the whole group **by construction** — there is no targeting. If reminders should be per-owner, the group robot is the wrong channel and something else is needed (or the reminder text has to name the owner and accept the noise). This is the sharpest question in the ticket.
2. **What the WeCom message contains.** It is visible to everyone in the group. Cost, selling price and margin are internal-only. Confirm the message carries client/product/deadline and nothing financial — and decide whether even client names are acceptable in a group that may include people outside the tender.
3. **What the in-app bell actually is.** `buildspec_1` names no table for it. Is there a `notifications` table with per-user read state, or is the bell a live query over overdue tenders? The second is far cheaper and may be enough.
4. **Failure and change semantics.**
   - The cron doesn't run for two days (Vercel outage, deploy gap). Do missed reminders fire late or get skipped?
   - A deadline moves *after* a reminder was sent. Does `sent = true` on that row stand, or reset? As specced, moving a deadline forward silently guarantees the reminder never fires again.
   - A reminder's `days_before` window is missed because the cron ran at 23:00 in one timezone and the date had rolled in another. Is the match on an exact date equality (fragile) or a range (safer)?
5. **Trigger mechanism.** Vercel Cron vs Supabase scheduled function — decide in light of ticket 03's hosting findings, since a hosting change invalidates one of them.

Read ticket 06's answer first: the observed webhook payload format and any rate limit shape what is deliverable.

---

## Note after tickets 02 and 03 resolved — this branch is clear

Both research tickets confirmed that **group robot webhooks require no trusted domain, no ICP filing, and no IP whitelist**. The webhook is an outbound HTTPS call to `qyapi.weixin.qq.com` authenticated by a key in the URL — none of the administrative machinery that may kill WeCom *login* touches it.

So while ticket 07's branch may collapse, **this one stands as specced**. Two consequences:

- Question 1 above (owner vs everyone) gets *more* important, not less. If WeCom login dies, the group robot becomes the only WeCom integration in the product, and its broadcast-to-everyone nature is then the whole notification story rather than one channel among several.
- Vercel Cron remains viable for the trigger (question 5) — 03's recommendation is to keep Vercel, and the webhook call needs no stable egress IP.

---

## Resolution

**The ticket's central premise was wrong.** Question 1 assumed a group robot "posts to the whole group **by construction** — there is no targeting", and concluded that per-person notification would require WeCom login, which tickets 02/03 found administratively dead. That is false. The [official message docs](https://developer.work.weixin.qq.com/document/path/91770) confirm `mentioned_mobile_list` — **@mentioning specific group members by phone number**. No WeCom userid, no OAuth, no trusted domain, no ICP filing. Targeted notification is available today via a `users.mobile` column.

Two constraints came with it: **only the `text` message type supports mentions** (so no markdown formatting in any message that @s someone), and each webhook is capped at **20 messages per minute**.

**1. Who is notified — targeted, per milestone.**
- `internal_quote` reminders @mention **only Assignees who have entered no Quotes yet**. A reminder that pings people who already did the work trains everyone to mute the robot within weeks.
- `client_submission` and `decision_chase` go to the Tender **Owner**.
- Outcome events notify **every Assignee who quoted that Item**, not just the winner — the losers' only feedback on how their supplier compared comes from this message. Differentiated wording ("your quote was selected and won" vs "the tender was won on Nok's quote").
- Outcome notifications fire on `won` and `lost` only; `no_bid` and `cancelled` are silent.

**2. Message content — financially silent.** Format: *"Tender #1042 — Bangkok Hospital — 'PICC catheter 4Fr' — WON @Somchai"*. Client, Item, outcome, @mention. **No prices, no margin, no supplier name** — supplier identity is commercially sensitive. Financial detail lives in the app, which the @mention drives people to.

**3. The bell must be a real `notifications` table** — `(id, org_id, user_id, type, tender_id, tender_item_id, body, read_at, created_at)`. The cheap live-query option died with the outcome-event requirement: "your quote won" is a discrete event with per-user read state and cannot be derived from tender data.

**5. Vercel Cron**, per 03.

**Beyond the ticket's original scope:**
- **A daily Digest** posted to the group listing every open Tender and its next milestone. Reminders only fire at thresholds, so they do nothing for the stated problem of *losing track of what's ongoing*; the Digest attacks that directly, costs one message a day, and reuses the same cron.
- **`reminders` gains `milestone`** (`internal_quote | client_submission | decision_chase`) plus **both** `days_before` (nullable) and `remind_on` (nullable), exactly one populated — decision-chase is **off by default** and set manually by the Owner on an absolute date, since clients rarely state one.
- **Escalation on `client_submission`**: defaults of 7, 3, 1 days plus morning-of; a Submission Missed Tender stays loudly on the dashboard rather than dropping out of the active list; and one group post when a submission is missed.
- **Batched per Tender** (not per Item) for WeCom; in-app notifications stay per-Item so the bell can deep-link.
- **No Supplier Found** — an Assignee's explicit record that they couldn't source an Item, which silences the nag. Without it, "didn't try" and "nobody could supply it" are indistinguishable and the sourcing reminder chases people forever for work that cannot be done.

**4. Failure and change semantics — all three are silent-failure bugs, all three fixed.** See [ADR-0005](../../../docs/adr/0005-reminder-delivery-semantics.md).

- **Missed cron → catch up, never skip.** Store a computed `due_date` per reminder row; query `due_date <= today AND NOT sent`, never `= today`. Exact date equality means one bad deploy day drops those reminders forever — unacceptable for a product built to stop missed submissions. Caught-up reminders whose milestone date has *already passed* are suppressed; Submission Missed covers that case more loudly.
- **Deadline moves → recompute and reset.** Recompute `due_date` on any deadline change and clear `sent`/`sent_at` where the new date is in the future. `buildspec_1`'s write-once `sent` boolean meant pushing a deadline back permanently silenced the Tender. Rows recomputing to a past date keep their flag, so pulling a deadline forward doesn't re-spam.
- **Timezone → org-level, `Asia/Bangkok` default.** Every date boundary computes in it; cron runs 01:00 UTC (08:00 Bangkok). Explicitly not per-user — a deadline belongs to the Tender, not the viewer, and per-user timezones would silently break every shared metric. Explicitly not server-local, since Vercel is UTC and would roll the day seven hours early.

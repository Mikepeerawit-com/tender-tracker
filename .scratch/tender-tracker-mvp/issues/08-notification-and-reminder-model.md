# 08 — Notification delivery and the reminder model

Type: grilling
Status: open
Blocked by: 06

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

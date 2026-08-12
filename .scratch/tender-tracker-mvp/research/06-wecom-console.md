# 06 — WeCom console: observed facts

Console findings for ticket `issues/06-register-wecom-app-and-robot.md`.
Captured 2026-08-12 via `wizard-06-wecom.sh`, then corrected by hand — see
[Corrections](#corrections-to-the-raw-capture). **No credentials in this file** —
those live in `.env` at the repo root (gitignored). Tickets 07, 08 and 12 read this.

**Ticket 06 is NOT resolved.** Three checks are settled; three are still open and
listed in [Still open](#still-open). Do not treat this as a green light.

---

## Status at a glance

| # | Check | Result |
|---|---|---|
| 1 | Group robot created, webhook delivers | ✅ **Settled** — works |
| 2 | `mentioned_mobile_list` @mentions a real person | ✅ **Settled** — works, **E.164 with `+` only** |
| 3 | Non-member number is silently ignored | ⚠️ **Open** — test was invalid |
| 4 | Mention renders for a second person | ⚠️ **Open** — not tested |
| 5 | Rate limit behaviour | ⚠️ **Open** — not tested |
| 6 | Org verification state | ✅ **Settled** — 未验证 / Unverified |
| 7 | Self-built app registered, credentials captured | ✅ **Settled** |
| 8 | 可信域名 accepted or rejected | ✅ **Settled** — rejected on **filing entity** (备案主体) |
| 9 | 企业可信IP enforced | ✅ **Settled** — **yes, enforced** |

---

## 1. Group robot — works

- **Robot created:** yes, in a 6-person test group
- **Webhook stored in:** `.env` → `WECOM_ROBOT_WEBHOOK` (repo root, gitignored)
- **Plain message delivery:** confirmed working, `{"errcode":0,"errmsg":"ok"}`

The robot path needs no trusted domain, no ICP filing and no IP whitelist, exactly
as `research/03-hosting.md` §3.5(a) predicted. **This part of `buildspec_1` is safe.**

## 2. Mention test — WORKS. Format is E.164 with a leading `+`.

Settled 2026-08-12 by `retest-mention-formats.sh`, which sent one message per
format variant to the same group and observed which produced a real notification.

| Format sent | Notified? |
|---|---|
| `+66933555055` — **E.164 with `+`** | ✅ **yes** |
| `66933555055` — country code, no `+` | ❌ no |
| `0933555055` — Thai local format | ❌ no |
| `933555055` — bare national number | ❌ no |
| `@all` | ❌ no |

**`mentioned_mobile_list` works and ticket 08's targeting design stands.** Targeted
per-Assignee reminders, the "nag only Assignees who haven't quoted" rule, and
per-Assignee outcome notifications are all deliverable as specified.

Working payload:

```json
{"msgtype":"text","text":{"content":"…","mentioned_mobile_list":["+66933555055"]}}
```

### ⚠️ Two traps for the implementation

**1. A wrong format is silently accepted and silently does nothing.** All four
non-working variants returned `{"errcode":0,"errmsg":"ok"}` and delivered the
message body — the mention simply never bound and no notification fired. **WeCom
never reports an unmatched number as an error**, so there is no runtime signal to
alert on, log, or retry.

Consequences for `buildspec_2`:
- `users.mobile` must be **stored in E.164 with the leading `+`**, and validated at
  write time — the API will never tell you it is wrong.
- A bad number is indistinguishable from a delivered notification in logs. Do not
  build a "notification sent" indicator on `errcode 0` alone; it means *accepted*,
  not *notified*. This is the same class of silent-failure bug ADR-0005 already
  caught in `buildspec_1`'s write-once `sent` flag.

**2. `@all` does not notify.** It is not available as a broadcast fallback if
targeting ever fails. Anything that needs to reach the whole group must mention
every member's number explicitly.

## 3. Mention test B — non-member — INVALID

- **Number sent:** `0933555055` — which is *the same person's own number in local
  format*, not a non-member's
- **Response:** `{"errcode":0,"errmsg":"ok"}`

The test did not do what it was meant to. It did incidentally establish that a
second number format also returns `errcode 0` without mentioning anyone —
consistent with §2's format-mismatch hypothesis, since neither format notified.

## 4. Mention test C — second person — NOT TESTED

Skipped; no second person available at the time.

## 5. Rate limit — NOT TESTED

Skipped. Docs claim 20 messages/minute per webhook; unverified here.

## 6. Org verification state — 未验证 (Unverified)

The admin console is set to **English**, so the state was read as "Unverified"
rather than from the Chinese string. Note this collapses a distinction that
matters: 已验证 and 已认证 are different states with different costs, and English
may render both as "Verified". The 未验证 reading is unambiguous, but if the state
ever reads "Verified", re-check it in Chinese before relying on it.

> **No verbatim text captured.** The original capture contained placeholder
> keystrokes, not console text, and has been removed rather than left to mislead
> ticket 07. If the exact wording matters later, re-read: My Company → Company Profile.

## 7. Self-built app — registered

- **App created:** yes
- **Credential storage (decision):** `.env` at repo root — gitignored, never
  committed. Not a secret manager: solo developer, greenfield, no CI yet.
- **Keys:** `WECOM_CORP_ID`, `WECOM_AGENT_ID`, `WECOM_SECRET`

## 8. 可信域名 attempt — the ICP requirement IS enforced. WeCom login is dead for v1.

- **Domain tried:** `tender.taihue.com` — aspirational; Taihue owns no domain for
  this app, and the host does not exist
- **Field used:** OAuth trusted domain (the one that gates `redirect_uri`)
- **Screenshot:** `06-trusted-domain.png` — **read it, it says more than the error line**

Verbatim, from the screenshot:

> **Domain name ownership verification failed**
> To secure company data, please configure a domain name whose **filing entity is
> the same as or related to the current company entity.**

**That second sentence is the catch-22, stated in English.** It is WeCom's
translation of `需配置备案主体与当前企业主体相同或有关联关系的域名` — the exact
console string `research/03-hosting.md` §3.3 quoted from Chinese-language reports.
**"Filing entity" is 备案主体 — the ICP filing.** WeCom's English UI renders
主体校验 as "ownership verification", which is why the error line alone reads like
a mere domain-control check. It is not.

**Reading:** the 备案/主体 requirement is enforced on this org, at 未验证, today.
Per `research/03-hosting.md` §3.4, an ICP filing requires a mainland-registered
entity **and** mainland-hosted servers — neither of which a Thailand-registered
company has. **WeCom web-OAuth login is not available for v1.** Ticket 07 should
take email/password and key identity on `wecom_userid` for a later migration.

**Residual uncertainty, stated honestly:** because the domain tried does not exist
and has no filing at all, this does not *separately* prove that a correctly-filed
domain under a *related* entity would be rejected. But Taihue cannot obtain such a
domain, so the distinction has no practical consequence. The requirement is
confirmed; only the precise failure mode is not.

### Form constraints, from the screenshot

- **OAuth2 callback domain: exactly one.** The field has no "Add More" control,
  unlike the JS-SDK field below it. Confirms research/03 §3.2.
- **JS-SDK domains: up to 10**, stated inline — "up to 10 domain names and
  verification is required". Confirms research/03 §3.2.
- **Ownership verification is a separate, additional requirement**, shown in its own
  panel: *"The domain name ownership verification is required to configure a trusted
  domain name"* with a "Domain name to be verified" link — the `WW_verify_*.txt`
  mechanism. So there are **two independent gates**: filing-entity match **and**
  domain-control proof. The filing gate is the one Taihue cannot pass.

### ⚠️ Contradiction with `research/03-hosting.md`

The org is **未验证**, yet the trusted-domain control was **usable** and accepted
input as far as ownership verification. Research/03 and ticket 02 both state that
配置可信域名 requires 已验证/认证 (*需已验证/认证企业才可操作*). Either that gate is
not enforced as documented, or it sits behind the ownership check. **Ticket 07
should not assume verification state blocks trusted-domain configuration.**

## 9. 企业可信IP — ENFORCED. Vercel serverless is disqualified.

Tested 2026-08-12 from an ordinary machine with 企业可信IP left empty.

| Endpoint | errcode |
|---|---|
| `/cgi-bin/gettoken` | **0** — succeeded |
| `/cgi-bin/department/list` | **60020** |
| `/cgi-bin/user/simplelist` | **60020** |
| `/cgi-bin/message/send` | **60020** |

```
not allow to access from your ip, hint: [...], from ip: <redacted>
more info at https://open.work.weixin.qq.com/devtool/query?e=60020
```

**`gettoken` is exempt from the IP whitelist; every business API is not.** This
matters because ticket 06 originally proposed `gettoken` alone as the test — which
returns `errcode 0` and looks like the constraint has evaporated. It has not.
Any future test of this must call a *business* endpoint.

**Consequences, and they are architectural:**

- Every WeCom **server API** call needs a stable, enterprise-attributable egress IP.
- **Vercel serverless cannot host WeCom-facing code** — dynamic egress IPs, and
  Vercel Static IPs cost $100/month (`research/03-hosting.md` §4).
- The proportionate fix is a **~$5/month fixed-IP VM** in Singapore or Hong Kong
  acting as a thin WeCom API proxy. Same outcome, 10–20× cheaper.
- **None of this touches the group robot webhook**, which is exempt — so if WeCom
  integration stays at "robot webhook only", no VM is needed at all. That is a real
  scope-cut option for ticket 11.

## 10. Restrictions and contradictions

Nothing recorded beyond the two contradictions noted in §8 and §9.

---

## Still open

All three are cheap, low-risk, and none blocks ticket 07 or 08 any longer.

1. **Mention for a second person** (§4)
   Now low-risk — the mechanism is proven and the format is known. Still worth one
   message to confirm it binds against *another* member's contact record, not just
   the sender's. Use E.164 with `+`.

2. **The 20/min rate limit** (§5)
   Untested. Shapes the Digest and reminder batching in ADR-0005.

3. **Is a non-member number silently ignored?** (§3)
   The original test was invalid. Now cheap to redo properly: send a well-formed
   E.164 number belonging to nobody in the group. Expected: `errcode 0`, no mention.
   Given §2's finding that *every* unmatched number is silently accepted, this is
   near-certain — but it is the guard condition ticket 08's code depends on.

---

## Corrections to the raw capture

Recorded so the edit history is not silently lost:

- **Session 1 (18:44) aborted** — the webhook URL was pasted with a stray newline,
  producing `curl: (3) URL rejected: Malformed input to a URL function` on every
  send. No findings from that session are valid; it has been dropped. Session 2
  (18:53) is the real run.
- **§6's verbatim block removed** — it contained placeholder keystrokes, not
  console text.
- **§9's conclusion reversed.** The wizard recorded *"gettoken succeeded WITHOUT an
  IP whitelist — the IP constraint may not bind here."* That reading was wrong, and
  followed from testing only `gettoken`. Business-endpoint calls made afterwards all
  returned 60020. The whitelist binds.
- **Public egress IP redacted** from §9 rather than committed to the repo.
- **§2 resolved by a second run.** The wizard's original reading — mention delivered
  as plain text, no notification — was a **number-format mismatch**, not a broken
  mechanism. `+66…` works; `66…`, `0…` and the bare number do not, and fail silently.
- **§8 upgraded from inconclusive to settled, by reading the screenshot.** The
  transcribed error line (`Domain name ownership verification failed`) omitted the
  explanatory sentence beneath it, which demands a matching **filing entity** —
  i.e. the 备案 requirement. The transcription alone read as a mere domain-control
  failure; the screenshot shows it is the ICP catch-22. **Lesson for future console
  work: capture the whole panel, not the red line.**

---

**Handoff.**

**Ticket 08 — no change needed.** `mentioned_mobile_list` works (§2). The design
stands as resolved. Two things to carry into `buildspec_2`: `users.mobile` must be
E.164 **with the leading `+`** and validated at write time, and `errcode 0` must
never be treated as proof of delivery — an unmatched number is silently accepted.

**Ticket 07 — decide against WeCom web-OAuth login.** §8 confirms the console demands
a 可信域名 whose **ICP filing entity** matches the enterprise entity. A Thai entity
cannot obtain one (`research/03-hosting.md` §3.4 — filing needs a mainland entity
*and* mainland-hosted servers). Take **email/password for v1** and key identity on
`wecom_userid` so a later migration stays open. This is what the map's default auth
posture already assumed; it is now evidence-backed rather than assumed. Also read §9
— Vercel cannot host WeCom-facing code — and the §8 verification contradiction.

**Ticket 11** should note that "robot webhook only" is a viable scope cut that removes
the fixed-IP VM, the trusted domain and the ICP question in one move — and that the
robot path is the only WeCom integration confirmed working end-to-end.

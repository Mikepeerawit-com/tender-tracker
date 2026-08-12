# 06 — Register the WeCom self-built app and group robot; capture the facts

Type: task (HITL — the user is Taihue's WeCom admin)
Status: open
Blocked by: —

## Question

Two of `buildspec_1`'s biggest claims — WeCom login and WeCom group-robot notifications — rest on what Taihue's WeCom console will actually let you do. Nobody has looked. This ticket replaces assumption with observation, cheaply, before tickets 07 and 08 try to decide anything.

It is the one ticket here that *does* rather than decides, and it earns that by unblocking two decisions.

**Work to perform** in Taihue's WeCom admin console:

1. Create the self-built app (自建应用). Record **Corp ID, Agent ID, Secret** and where they are stored (a secret manager, `.env.local`, a password manager — decide and note it; do not paste secrets into this file or any ticket).
2. Configure the trusted domain (可信域名) as far as it will go without a deployed domain, and **record exactly what it demands**: a hosted verification file? A live reachable domain? An ICP filing? An IP allowlist for API calls? Screenshot or transcribe the requirement text.
3. Create the team group and generate a **group-robot webhook URL**.
4. **POST one test message to the webhook and confirm it lands in the group.** Record the exact payload that worked and the response.
5. Note any restriction the console surfaced: org-verification prompts, member limits, admin-permission gates, rate limits on the robot.

**Answer must record:** credential storage location (not the credentials), the working webhook message format, the verbatim trusted-domain requirement, and anything encountered that contradicts `buildspec_1`. Ticket 07 and ticket 08 both read this.

If a step is blocked by something in the console, record the blocker and resolve the ticket anyway — a known blocker is a finding, not a failure.

---

## Added after ticket 02 resolved — three now-critical checks

Ticket 02's research found that the binding constraint on WeCom login is **administrative, not technical**, and that the slow items have weeks of lead time. All three are answerable in the same console session, and 07 cannot decide without them. Do these **first** — they matter more than the app registration itself.

1. **What is Taihue's WeCom org verification state — 未验证, 已验证, or 已认证?**
   Configuring a 可信域名 at all requires 已验证/认证 (*配置可信域名必须要有主体，需已验证/认证企业才可操作*). Without a trusted domain there is **no login flow** — `redirect_uri` fails with error 50001. If Taihue is already 已验证 or 已认证, this is a non-issue; if not, it's a prerequisite with third-party review lead time, and 认证 costs RMB 300+ per app plus a member-size fee.

2. **Does Taihue own an ICP-filed (备案) domain, filed under Taihue's own entity?**
   The 可信域名 must be ICP-filed, 工信网-findable, and its 备案主体 must match the enterprise's verified entity. A `*.vercel.app` host fails all three. If no such domain exists, ICP 备案 is **weeks**, and it sits on the critical path of every WeCom-login option. Record: does one exist, what is it, and who is the 备案主体?
   While you're in the console, note the exact 可信域名 form: **only 1 OAuth2 callback domain per app**, exact match, no wildcards, ports must be registered, and each second-level domain needs a `WW_verify_*.txt` served from its root **which must never be deleted**.

3. **Empirically test whether 企业可信IP is enforced.** *(The one genuinely undocumented question — 02 flagged it as unresolvable from docs.)*
   Call `GET /cgi-bin/gettoken?corpid=…&corpsecret=…` from an ordinary machine **without** adding its IP to 企业可信IP, and record the result. If it returns error **60020** (不安全的访问IP), then every WeCom API call needs a stable, enterprise-attributable egress IP — which **disqualifies Vercel serverless** for the WeCom-facing code and forces a separate always-on host. If it succeeds, that constraint evaporates. This is a five-minute test that decides a piece of architecture; do not skip it or reason about it from the docs.

Record all three verbatim where the console gives text. Tickets 07 and 08 both read this.

---

## Revised after ticket 03 resolved — check 2 is now the whole ballgame

03 found that ICP filing requires a mainland-registered entity **and** mainland-hosted servers. So an ICP-filed 可信域名 and Vercel hosting are **mutually exclusive**, and check 2 above stops being "does Taihue have a filed domain?" — a Thai entity almost certainly cannot get one. Both research tickets independently converged on the same five-minute test as the only way to settle it:

**→ In the WeCom admin console, simply attempt to add a trusted domain (可信域名) for the self-built app. Screenshot whatever happens.**

That is the test. Three outcomes, each decisive for ticket 07:

- **Blocked on org verification** (需已验证/认证企业才可操作) → establish Taihue's verification state first, then retry.
- **Accepted, then rejected on 备案/主体 grounds** (域名主体校验未通过, or a demand for an MIIT-findable filing) → **WeCom web-OAuth login is dead for v1.** Confirms the catch-22.
- **Accepted** → overseas-entity orgs are treated differently than the docs imply, which no documentation states. Record it carefully; it reopens WeCom login as genuinely viable.

Neither research agent could resolve this from documentation — WeCom publishes no policy page covering orgs registered under a non-mainland entity. You are the admin; you can settle in five minutes what a week of reading cannot.

**Check 3 above is now partly answered by docs, so downgrade it.** 03 found the policy: self-built apps created after **2022-06-20 20:00** must whitelist calling IPs (max 120, IPv4, no CIDR, third-party-provider IPs rejected). So 60020 is expected, not uncertain. Still worth confirming empirically, but it no longer decides anything on its own — and note the cheap answer is a ~$5/mo fixed-IP VM as a thin WeCom API proxy, not Vercel Static IPs at $100/mo.

**Check the robot first, though.** 03 confirmed group robot webhooks need **no domain, no filing, and no IP whitelist**. That part of the buildspec is safe regardless of how the above goes, so step 4 (POST a test message) should still succeed even if everything else in this ticket hits a wall.

---

## Revised after ticket 08 resolved — step 4 must now test an @mention, not just a message

08 established that the **entire notification design depends on targeting individuals via `mentioned_mobile_list`** — @mentioning a specific group member by phone number, per the [message docs](https://developer.work.weixin.qq.com/document/path/91770). This needs no WeCom login, no trusted domain and no ICP filing, which is why 08 resolved despite 07's branch looking dead. It is now the single most load-bearing WeCom fact in the project, and **it has never been tested against a real group.**

So step 4 changes. Posting a plain message is no longer sufficient:

1. **POST a `text` message including `mentioned_mobile_list` with your own mobile number**, and confirm you are actually @mentioned in the group — a real notification, not just text that looks like a mention. Record the exact payload and response.
2. **Confirm what happens when the number belongs to someone not in that group.** Expected: silently ignored. If it errors instead, the notification design needs a guard. Either result is a finding.
3. **Confirm the mention renders for a second person**, not just the sender.
4. Note the observed rate limit behaviour if you can — docs say **20 messages/minute per webhook**, which the daily digest and reminder batching are designed around.

If `mentioned_mobile_list` does **not** work for Taihue's group, ticket 08 must be reopened: targeted reminders, the "nag only Assignees who haven't quoted" rule, and per-Assignee outcome notifications all collapse back to broadcast, and the notification design needs rethinking. **Test this before anything else in this ticket** — it is cheaper than the trusted-domain test and carries more of the product.

---

## Partial progress 2026-08-12 — still open

A console session was run (`wizard-06-wecom.sh`). Findings, with a per-check status
table and the exact remaining tests: **[`research/06-wecom-console.md`](../research/06-wecom-console.md)**.

**Settled:**
- Group robot created; plain webhook delivery works. No domain, no filing, no IP
  whitelist — `buildspec_1`'s notification transport is safe.
- **`mentioned_mobile_list` works.** Ticket 08's targeting design stands, no reopen
  needed. The format is **E.164 with a leading `+`** (`+66…`); `66…`, `0…` and the
  bare national number are all **silently accepted and silently do nothing**, and
  `@all` does not notify either. `users.mobile` must be stored and validated as
  E.164 with `+`, and `errcode 0` must never be read as proof of delivery.
- Self-built app registered. Corp ID / Agent ID / Secret in `.env` at the repo root
  (gitignored). That is the recorded credential-storage decision.
- Org state is **未验证 / Unverified**.
- **企业可信IP is enforced.** `gettoken` succeeds but *every* business API returns
  **60020**. Vercel serverless is disqualified for WeCom-facing code; budget a
  ~$5/mo fixed-IP VM, or cut self-built-app APIs and keep only the robot.
- **可信域名 is rejected on ICP filing-entity grounds — WeCom web-OAuth login is
  not available for v1.** The console demands *"a domain name whose filing entity
  is the same as or related to the current company entity"* (备案主体). A Thai
  entity cannot obtain an ICP filing. **Ticket 07 should take email/password** and
  key identity on `wecom_userid`. See `06-trusted-domain.png`.

**Still open — none of these block tickets 07, 08 or 12:**
1. Second-person mention, the 20/min rate limit, and a proper non-member-number
   test were not done. All three are cheap and low-risk.

**Two contradictions with the research worth carrying forward:**
- The org is 未验证, yet the trusted-domain control was **usable**. Research/03 and
  ticket 02 both say 配置可信域名 requires 已验证/认证. Ticket 07 should not assume
  verification state blocks it.
- `gettoken` is **exempt** from the IP whitelist. Testing it alone returns
  `errcode 0` and looks like the constraint has evaporated. It has not — this
  ticket's own step 3 proposed exactly that misleading test.

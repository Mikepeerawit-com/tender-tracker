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

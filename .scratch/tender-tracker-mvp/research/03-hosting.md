# 03 — Hosting and reachability for international users

Research findings for ticket `issues/03-hosting-reachability.md`.
Researched 2026-08-11. All sources dated; the China networking landscape shifts, so treat anything
older than ~18 months as directional rather than current.

---

## TL;DR

**Two separate problems got bundled into one ticket. They have different answers.**

**Problem A — network reachability.** Hinges *entirely* on whether any actual user is physically
sitting in mainland China. If nobody is, Vercel + Supabase is fine and there is nothing to fix.
If somebody is, it is fixable with a custom domain and a region change — not a re-platform.
**This is one question to the user, not a hosting redesign.** See [The one question](#the-one-question).

**Problem B — WeCom's trusted-domain requirement.** Does **not** depend on where users sit. WeCom
requires the OAuth `redirect_uri` domain to be a configured 可信域名, and WeCom's own help centre
states that setting a 可信域名 requires an **ICP filing (备案) verifiable on the MIIT registry**, with
the filing entity matching (or affiliated to) the WeCom-verified enterprise entity. A
Thailand-registered company cannot obtain that without a mainland subsidiary or representative
office. **This is a blocker for the WeCom web-OAuth login flow specifically, and no hosting choice
short of "mainland entity + mainland hosting" fixes it.** It is largely ticket 02's call, but it has
hosting consequences recorded here.

**Problem C (discovered, not in the ticket) — WeCom's trusted-IP whitelist.** Self-built apps created
after 2022-06-20 can only call WeCom server APIs from IPs on a manually-maintained whitelist (max
120, IPv4, no CIDR). Vercel functions have dynamic egress IPs; the fix on Vercel costs **$100/month**.
A $5/month VM with a fixed IP does the same job. See [§4](#4-wecoms-trusted-ip-whitelist-the-real-vercel-problem).

**Recommendation: KEEP Vercel + Supabase**, with four cheap hardening changes, and move the WeCom
domain/IP constraints into the auth decision. Full reasoning in [§7](#7-recommendation).

---

## 1. Vercel reachability from mainland China

### 1.1 `*.vercel.app` is actively blocked — treat it as unusable for mainland users

Vercel's own knowledge base article, **published 2025-11-03, last updated 2025-11-10**, says:

> "China's network controls may block or throttle traffic to foreign domains, including Vercel's
> `.vercel.app` subdomains."

and

> "Vercel cannot guarantee availability or performance within mainland China."

— [Accessing Vercel-hosted sites from mainland China, Vercel Knowledge Base](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china) (published 2025-11-03, updated 2025-11-10)

The mechanism is documented in Vercel's own community repo. The report (**2022-08-27**) found two
independent blocks on `*.vercel.app`:

1. **DNS pollution** — queries from inside China resolve to blackholed IPs (`103.252.114.101`,
   `108.160.163.106`) instead of the real Vercel anycast IPs (`76.76.21.9`, `76.76.21.241`).
2. **SNI blocking on port 443** — even with correct DNS, the TLS handshake is reset because the SNI
   field contains `vercel.app`. Port 80 still redirects normally, which is the classic signature of
   SNI-based interception rather than IP blocking.

A Vercel maintainer (`swarnava`) confirmed on the thread:

> "Our domain `*.vercel.app` sometimes is blocked by the firewall of China as it deemed some of the
> content hosted on these domains too sensitive for its citizens."

— [`vercel.app` Blocked by SNI and DNS Pollution in China · vercel/community #803](https://github.com/vercel/community/discussions/803) (2022-08-27)

This is the expected outcome for any shared apex used by millions of user-generated deployments — the
domain gets blocked as a unit because of *other people's* content. It is not about this app.

### 1.2 A custom domain materially changes the answer — but does not guarantee it

Vercel's recommendation is explicit:

> "Swap the `.vercel.app` domain for your own custom domain. These are less likely to be flagged or
> blocked."

— [Vercel KB](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china) (2025-11-10)

The mechanism is sound: the SNI block matches on the hostname string, and DNS pollution is applied
per-domain. A previously-unknown custom domain is not on either list. Vercel's underlying anycast IPs
(`76.76.21.21` and friends) are **not** IP-blocked — the #803 evidence shows they resolve and serve
fine when reached directly, which is why port 80 works.

**Caveats you should hold:**

- "Less likely to be flagged" is not "will work". Vercel declines to guarantee it, twice, in its own
  doc. There is no SLA here.
- Blocking can be applied to a custom domain later, at any time, without notice or appeal.
- Vercel does **not** support IPv6 for custom domains
  ([Troubleshooting domains](https://vercel.com/docs/domains/troubleshooting), last updated
  2026-07-20), so all mainland traffic traverses the congested IPv4 international gateways.

### 1.3 A widely-repeated "China fix" is NOT in Vercel's documentation

Multiple secondary sources recommend pointing custom domains at `cname-china.vercel-dns.com` (CNAME)
or `76.223.126.88` (A record) instead of the standard `cname.vercel-dns-0.com` / `76.76.21.21`.

**I could not verify this against any Vercel primary source.** I checked
[Working with DNS](https://vercel.com/docs/domains/working-with-dns) (last updated 2026-06-08) and
[Troubleshooting domains](https://vercel.com/docs/domains/troubleshooting) (last updated 2026-07-20).
Neither mentions China, `cname-china.vercel-dns.com`, or `76.223.126.88`. The KB article that *is*
about China does not mention them either.

**Treat this as community folklore until Vercel documents it.** If it matters, ask Vercel support
directly. Do not build a plan on it.

### 1.4 Latency: no China PoP, expect a bad-but-usable experience at best

Vercel's edge network has no mainland China presence. The nearest function/edge regions are `hkg1`
(Hong Kong), `icn1` (Seoul), `hnd1` (Tokyo), `sin1` (Singapore)
([Global network and regions](https://vercel.com/docs/regions)). All mainland traffic therefore
crosses an international gateway.

Vercel's own guidance is to reduce third-party dependencies and self-host resources — i.e. minimise
round trips, because each one is expensive
([Vercel KB](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china), 2025-11-10).

Community reports are consistent and unflattering. A Vercel community thread from **2025-05-19**
reports a mainland user unable to load a Vercel-hosted site at all without a VPN, "stuck loading"
across multiple refreshes; the reply attributes it to the absence of mainland edge nodes and
recommends a China-based CDN layer in front
([China project access, network access failed — Vercel Community](https://community.vercel.com/t/china-project-access-network-access-failed/10968), 2025-05-19).

Secondary sources citing "3–8x slower" load times in China circulate widely
(e.g. [21YunBox](https://www.21cloudbox.com/solutions/how-to-speed-up-vercel-in-china.html)) but these
are vendors selling a China-hosting product, so the number is marketing, not measurement. **The
directionally-safe planning assumption: 300–800ms+ RTT, high jitter, sporadic connection resets, and
occasional total failure during periods of tightened filtering.** For a low-frequency internal CRUD
app this is annoying but survivable; for photo uploads it is genuinely painful.

**Note on Static IPs interacting with function limits:** if you later enable Vercel Static IPs (see
§4), you lose the large-functions beta and >800s durations
([Vercel Functions Limits](https://vercel.com/docs/functions/limitations), last updated 2026-07-01).
Neither matters for this app.

---

## 2. Supabase reachability from mainland China

### 2.1 Evidence of blocking is real but thinner and older than Vercel's

The clearest primary artefact is a Supabase issue reporting that both the website and the API were
unreachable from China, with Auth magic-link requests receiving no response at all — i.e. a
transport-level block, not an application error.

— [(Seems) supabase api and website are blocked from China · supabase/supabase #2631](https://github.com/supabase/supabase/issues/2631) (opened 2021-07-29, now closed)

**That report is five years old.** I found no current, well-evidenced first-party confirmation that
`*.supabase.co` is presently GFW-blocked. Notably, Supabase's own 2026 incident write-up on regional
blocks covers **UAE (Sept 2025), Yemen (Feb 2026), and India (Feb–Mar 2026)** — and **does not
mention China at all**
([Navigating Regional Network Blocks, Supabase blog](https://supabase.com/blog/navigating-regional-network-blocks), 2026-03-26).

Two readings, both worth holding:
- Optimistic: China is not currently blocking `supabase.co` wholesale.
- Pessimistic: Supabase writes up blocks it can negotiate away; China is not a jurisdiction where
  that pipeline works, so it simply does not appear in the post.

**Do not treat Supabase as safely reachable from the mainland.** Treat it as "probably degraded,
possibly blocked, no guarantee, and no vendor recourse if it changes."

### 2.2 Storage is the exposure that matters, and it is fixable

The buildspec has the browser talking directly to Supabase for Auth and Storage (quote photo upload
is the heaviest payload in the app). That means a **second** foreign domain — `<ref>.supabase.co` —
must be reachable from every user's browser, in addition to the app domain. Two independent
single-points-of-failure instead of one.

Supabase's **Custom Domains** add-on collapses this. Per the docs, once active:

> "Your Edge Functions will now be available at `https://api.example.com/functions/v1/...`, and your
> Storage objects at `https://api.example.com/storage/v1/object/public/...`"

and Supabase Auth switches to the custom domain immediately.

— [Custom Domains | Supabase Docs](https://supabase.com/docs/guides/platform/custom-domains)

Constraints from the same doc:
- One custom domain per project; you cannot split resources across several.
- CNAME records only.
- Paid add-on on a paid plan.

Pricing: **$10/month per domain per project**; Pro plan starts at **$25/month**
([Supabase Pricing](https://supabase.com/pricing), retrieved 2026-08-11).

So for **$10/month** you eliminate `*.supabase.co` from the browser entirely and reduce the
reachability surface to one hostname you control. **This is the single highest-leverage change in
this whole document, and it is cheap enough to do unconditionally.**

### 2.3 Region choice: Singapore

Supabase has **no Hong Kong (`ap-east-1`) region**. The Asia-Pacific options are `ap-southeast-1`
(Singapore), `ap-northeast-1` (Tokyo), `ap-northeast-2` (Seoul), `ap-south-1` (Mumbai),
`ap-southeast-2` (Sydney)
([Available regions | Supabase Docs](https://supabase.com/docs/guides/platform/regions)).

**Singapore (`ap-southeast-1`) is the right pick.** It is the best available for Thailand — where the
actual customer is — and acceptable for southern mainland China. Do not default to `us-east-1`; that
would add ~200ms of pure geography to every request for *all* users, mainland or not. This is worth
getting right regardless of how the China question resolves.

Match Vercel's function region to it (`sin1`) so server→database hops stay intra-region.

---

## 3. What WeCom imposes on the domain — the ICP question

**This is the finding that could reshape the plan, and it does not depend on user location.**

### 3.1 The trusted domain is required for the OAuth flow

WeCom's Web login component doc states plainly:

> "redirect_uri的域名必须配置为可信域名"
> *(the domain of `redirect_uri` must be configured as a trusted domain)*

with error `-31039` when the `redirect_uri` does not match the configured trusted domain. For
self-built apps (自建应用) the domain is configured as the OAuth 可信域名 or 网页授权回调域.

— [Web登录组件 — 企业微信开发者中心](https://developer.work.weixin.qq.com/document/path/98152)

Notably, *this* doc does not mention 备案. The requirement appears in the admin help centre instead.

### 3.2 WeCom's help centre says the trusted domain must be ICP-filed

From WeCom's official help centre page on custom-app trusted domains:

> "设置可信域名需要备案，去除微信侧的风险提示的话，也需要进行备案"
> *(Setting a trusted domain requires ICP filing; removing the WeChat-side risk warning also requires ICP filing)*

> "绑定在应用中的可信域名需工信网上可查到"
> *(The trusted domain bound to the app must be findable on the MIIT website)*

> "域名备案成功，建议在备案成功后72小时再绑定使用"
> *(After the filing succeeds, wait 72 hours before binding it)*

Plus a separate ownership check:

> "每个二级域名需要做归属校验，需要将校验文件放到域名根目录下"
> *(Each second-level domain requires ownership verification; place the verification file at the domain root)*
> "域名所有权文件在校验后不能删除"
> *(The ownership file must not be deleted after verification)*

Limits: **one** OAuth2 callback domain; up to 10 JS-SDK/mini-program domains. No protocol prefix, no
IP addresses, no short-link domains, no underscores.

— [自建应用可信域名说明 — 企业微信帮助中心](https://open.work.weixin.qq.com/help2/pc/21316)

### 3.3 The filing entity must match the WeCom enterprise entity

The admin console rejects mismatches with:

> "域名主体校验未通过，需配置备案主体与当前企业主体相同或有关联关系的域名"
> *(Domain entity verification failed — you must configure a domain whose ICP filing entity is the
> same as, or affiliated with, the current enterprise entity)*

Affiliation is interpreted as parent/subsidiary or head-office/branch. Reported resolution path is to
have an admin or sub-admin contact WeCom support and submit a form for manual review — a bot will not
handle it.

— [WeChat open community: 域名主体校验未通过](https://developers.weixin.qq.com/community/develop/doc/000e8428bd855026640f638fc51800)
— [企业微信开发者中心: 域名主体校验未通过](https://developer.work.weixin.qq.com/community/question/detail?content_id=16408877763293298820)
— corroborated by [企业微信接入系列-自建应用 (CSDN)](https://blog.csdn.net/csdn565973850/article/details/139352173) (2024)

### 3.4 A Thailand-registered company cannot obtain an ICP filing directly

Per Alibaba Cloud's official ICP filing documentation for non-mainland enterprises:

- ICP filing requires an entity with **mainland China business registration**. Foreign companies
  cannot apply as an overseas entity.
- A foreign company with a **registered mainland subsidiary** can file using the subsidiary's
  certificate.
- Without a subsidiary, the route is a **Foreign (Regional) Enterprise Resident Representative Office
  registration certificate** from the local AIC, used in place of a business licence.
- **The servers must be in mainland China.** Filing only applies to sites whose physical servers are
  in the mainland; a site hosted in Hong Kong, Singapore, the US or Europe cannot be filed (and does
  not legally need to be).

— [境外企业申请ICP备案的须知与要求 — 阿里云](https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/icp-filing-application-for-enterprises-outside-the-chinese-mainland)

Timelines, per Cloudflare's China Network documentation: **ICP filing 1–2 months; ICP licence
2–3 months**. Cloudflare's eligibility table shows filings are open to representative offices, WFOEs,
joint ventures and local companies — but ICP *licences* only to joint ventures (<50% foreign
ownership) and local companies.

— [Internet Content Provider (ICP) — Cloudflare China Network docs](https://developers.cloudflare.com/china-network/concepts/icp/)

**The catch-22 for this project:** an ICP filing requires mainland-hosted servers, which means the app
cannot be on Vercel. So "get an ICP filing and keep Vercel" is not an available option — it is
"establish a mainland entity **and** move hosting into mainland China **and** wait 1–2 months", which
is a completely different project.

### 3.5 What still works WITHOUT an ICP-filed domain

This is the important nuance, and it is good news for the parts of the app that matter most.

**a) Group robot webhooks — no domain requirement whatsoever.** The notification design in the
buildspec (§Notifications) posts to a WeCom group robot webhook URL. That is an *outbound* HTTPS call
from your server to `qyapi.weixin.qq.com` authenticated by a key in the URL. There is no domain to
register, no callback, no filing, and no IP whitelist (see §4). **The buildspec's notification design
is unaffected by any of this.**

**b) Server-side API access via 接收消息服务器URL instead of 可信域名.** The admin console gates the
trusted-IP config behind:

> "配置企业可信IP前，请先 设置可信域名 或 设置接收消息服务器URL"
> *(Before configuring enterprise trusted IPs, first set a trusted domain **or** set a receive-message
> server URL)*

The 接收消息服务器URL is the callback endpoint WeCom posts events to. Its documented requirements are
only that it speaks **http or https** (https recommended), and answers the GET verification handshake
by decrypting `echostr` and echoing the plaintext within 1 second. **The doc says nothing about 备案.**

— [接收消息与事件 概述 — 企业微信开发者中心](https://developer.work.weixin.qq.com/document/path/90238)
— error string corroborated across many independent reports, e.g.
  [lyc8503/WechatPush #1](https://github.com/lyc8503/WechatPush/issues/1) (2022-09-29) and
  [企业微信小程序登录，错误码60020 (CSDN)](https://blog.csdn.net/LY2497935393/article/details/131595148)

So: **server-to-server WeCom API calls (gettoken, message send, user lookup) are achievable on an
unfiled domain.** It is specifically the **in-client browser OAuth flow** — the thing the buildspec's
WeCom login depends on — that needs the ICP-filed trusted domain.

### 3.6 Confidence and handoff

Confidence that the ICP requirement for 可信域名 is real: **high** — it is stated on WeCom's own help
centre and corroborated by the admin console's error strings across many independent reports.

Confidence about how it applies to a **WeCom org registered under a non-mainland entity**: **low**.
I found no official WeCom policy page addressing overseas-entity orgs, and community threads note the
absence of any exemption (unlike WeChat Mini Programs, where overseas-entity accounts *are* exempt
from filing). Whether Taihue can even complete WeCom enterprise verification (认证) with a Thai
business licence is the upstream question — and that belongs to **ticket 02 (WeCom auth)**.

**Cross-link to ticket 02:** the hosting consequence is recorded here so it is not researched twice.
If ticket 02 concludes WeCom web-OAuth login is unavailable without an ICP filing, the correct
response is **to change the auth design (email/password + optionally WeCom QR or group-robot-based
flows), not to change the hosting.** Re-platforming to mainland China to satisfy WeCom OAuth would be
a wildly disproportionate response for an MVP with one design-partner customer.

---

## 4. WeCom's trusted-IP whitelist — the real Vercel problem

Not in the ticket, but it is a direct hosting constraint and it bites Vercel specifically.

From WeCom's official pre-development reading and help centre:

> "为了企业的数据安全，从2022年6月20号20点之后，新开启的通讯录同步助手与新创建的自建应用必须在管理端配置可信IP，仅配置的可信IP能调用接口。"
> *(For enterprise data security, from 2022-06-20 20:00, newly-enabled contact-sync assistants and
> **newly-created self-built apps must configure trusted IPs** in the admin console; only configured
> trusted IPs can call the APIs.)*

— [开发前必读 — 企业微信开发者中心](https://developer.work.weixin.qq.com/document/path/90664)
— [可信IP说明 — 企业微信帮助中心](https://open.work.weixin.qq.com/help2/pc/21711)

Constraints from the help centre page:
- **Maximum 120 trusted IPs per app**
- **No IP ranges, no wildcards** — individual addresses only
- **Public IPv4 only** (IPv6 unsupported)
- Third-party service-provider IPs are rejected by the system

Calls from a non-whitelisted IP fail with error **60020 `not allow to access from your ip`**
(widely reported, e.g.
[企业微信应用获取用户身份返回60020](https://developers.weixin.qq.com/community/enterprisewechat/doc/00060a7c3a83304edb5e53a9c5bc00)).

**Why this is a Vercel problem.** Vercel Functions egress from shared AWS address space with no
stable outbound IP. You cannot enumerate 120 addresses and be done — they change. Vercel's own
answer is the **Static IPs** product:

> "Static IPs are priced at **$100/month per project** for Pro plus Private Data Transfer priced
> regionally"

It is a shared-VPC model (not dedicated), covers both function and — optionally — build egress, and
gives one static IP **pair per configured region**. Dedicated IPs require Secure Compute, which is
Enterprise-only with custom pricing.

— [Static IPs — Vercel Docs](https://vercel.com/docs/networking/static-ips) (last updated 2026-06-30)

**$100/month to satisfy an IP whitelist is absurd for this app's scale.** If the app needs WeCom
server APIs at all, the proportionate answer is a **~$5/month VM in Singapore or Hong Kong** acting as
a thin WeCom API proxy with one fixed IP, with Vercel calling it. That is one small box, one IP, and
it also solves §3.5(b) — it can host the 接收消息服务器URL endpoint that unlocks the trusted-IP
config in the first place.

**Caveat:** the group robot webhook path (which is what the buildspec's notifications actually use)
requires **no** IP whitelist — the requirement applies to self-built app API calls, not webhooks
(consistent with the docs above, which scope the rule to 自建应用 and 通讯录同步助手). So if WeCom
integration stays at "group robot webhook only", none of §4 applies.

---

## 5. Fallback options, with rough cost and complexity

Ordered cheapest/simplest first.

### Option 1 — Custom domains everywhere (do this regardless)
Point a custom domain at Vercel, and buy the Supabase Custom Domain add-on so the browser never
resolves `*.supabase.co` either. Host the Supabase project in `ap-southeast-1` (Singapore) and set
Vercel's function region to `sin1`.

- **Cost:** domain ~$12/yr + Supabase Pro $25/mo + custom domain add-on $10/mo. Vercel Hobby/Pro as
  already planned.
- **Complexity:** ~1 hour of DNS work.
- **Buys you:** removes the *known* `*.vercel.app` block entirely; removes the second foreign
  hostname from the browser; meaningfully better latency for Thailand users too.
- **Does not buy you:** any guarantee. Vercel says so explicitly.

### Option 2 — Small fixed-IP VM as a WeCom API proxy
Only needed if WeCom **self-built app** server APIs are used (not needed for group robot webhooks).

- **Cost:** ~$5–15/month (Alibaba Cloud or Tencent Cloud Hong Kong / Singapore, or any small VPS).
  Alibaba Cloud confirms **no ICP filing is required for Hong Kong / non-mainland regions**
  ([ICP filing scope, Alibaba Cloud](https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/icp-filing-application-for-enterprises-outside-the-chinese-mainland)).
- **Complexity:** low — one box, one process, one IP to whitelist. Adds an ops surface (patching,
  uptime) that Vercel otherwise removed.
- **vs. Vercel Static IPs at $100/month:** 10–20x cheaper for the same outcome.

### Option 3 — Accept degraded performance for mainland users
Design the app to tolerate it: aggressive client-side caching, small payloads, optimistic UI,
client-side image compression before upload, resumable/chunked uploads, and generous timeouts.

- **Cost:** engineering time only.
- **Complexity:** moderate, and mostly things you should do anyway.
- **Specific to this app:** compress quote photos in the browser before upload. If uploads are ever
  proxied through a Vercel function rather than going direct to Storage, note the hard **4.5 MB
  request/response body limit** (error 413 `FUNCTION_PAYLOAD_TOO_LARGE`) —
  [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) (2026-07-01). A modern
  phone photo can exceed that. **Prefer direct-to-Storage uploads via signed URLs on the Supabase
  custom domain.**

### Option 4 — CDN in front for mainland acceleration
**Requires an ICP filing.** Every mainland-capable CDN gates on it:

- **Cloudflare China Network** — separate Enterprise subscription operated with JD Cloud, requires a
  valid ICP filing/licence per apex domain plus JD content vetting
  ([Cloudflare China Network docs](https://developers.cloudflare.com/china-network/), ICP page as
  cited above).
- **Tencent EdgeOne** — selecting the Chinese-mainland or Global availability zone requires completed
  MIIT ICP filing; without it "you can only choose to use the Global AZ (excluding Chinese mainland)"
  ([Tencent EdgeOne docs](https://edgeone.ai/document/54208)).

- **Cost:** Enterprise contracts, typically four to five figures annually, plus the filing project.
- **Complexity:** very high. **Not viable for this MVP.**

### Option 5 — Mainland-hosted mirror / full mainland deployment
Establish a mainland entity (WFOE or rep office), obtain an ICP filing (1–2 months), host on Alibaba
Cloud or Tencent Cloud in-mainland, and run a second deployment with a second database.

- **Cost:** entity setup is the dominant cost (thousands of USD and months), plus hosting, plus
  permanent operational overhead of a split-brain deployment.
- **Complexity:** very high. Data-residency and cross-border data-transfer rules (PIPL) become live
  concerns the moment you hold personal data in-mainland.
- **Verdict:** **Wildly disproportionate for an MVP with one free design-partner customer.** Only
  revisit if the business decides to sell into mainland China as a market. Note this is the *only*
  path that satisfies the WeCom trusted-domain requirement in §3.

---

## The one question

**Everything in §1, §2 and §5 collapses to a single question:**

> Will anyone who actually uses this app be sitting in **mainland China** when they use it — or are
> the Simplified-Chinese-reading staff all physically in Thailand (and possibly Hong Kong, Taiwan,
> Singapore, or elsewhere)?

Hong Kong, Macau, Taiwan and Singapore are **outside** the Great Firewall. Chinese-speaking staff are
not the same thing as mainland-located staff, and the buildspec describes a Thailand-registered
company with a Thailand-based first customer.

- **If nobody is on the mainland:** there is no reachability problem. Vercel + Supabase is a good
  stack. Do Option 1 anyway (it is cheap and helps Thailand latency), pick Singapore, and stop
  thinking about this.
- **If somebody is on the mainland:** it is still not a re-platform. Do Option 1 + Option 3, accept
  that it will sometimes be slow or briefly unreachable, and set expectations with the user rather
  than spending months on Options 4/5.

**The question that does *not* collapse** is §3 — WeCom's ICP-filed trusted domain — because it is
enforced at configuration time by WeCom regardless of where anyone sits. That one belongs to
ticket 02.

---

## 6. Assumptions and gaps

Recording these honestly so nobody over-reads this document.

- **I could not test reachability from inside mainland China.** Everything here is documentary. If
  the answer to [The one question](#the-one-question) is "yes, someone is on the mainland", the
  cheapest next step by far is to **have that person open a test Vercel deployment on a custom domain
  and report what happens.** One WeCom message beats a week of research.
- **The Supabase-blocked-in-China evidence is from 2021** and I found no current first-party
  confirmation either way. Current status is genuinely unknown to me.
- **`cname-china.vercel-dns.com` is unverified** and absent from Vercel's docs (§1.3).
- **Whether WeCom's 备案 requirement is enforced identically for overseas-entity orgs is unconfirmed.**
  No official policy page found. Ticket 02 should establish this — ideally by having Taihue's WeCom
  admin simply try to add a trusted domain and screenshot the result. That is a five-minute empirical
  test that settles a question no amount of documentation reading will.
- **"3–8x slower" latency figures come from vendors selling China hosting** and should be treated as
  marketing, not measurement.

---

## 7. Recommendation

### **KEEP Vercel + Supabase.** Change four things, and ask one question.

**Evidence for keeping:**
1. The one *documented, confirmed* block is on `*.vercel.app` — a shared domain the app should never
   have used in production anyway. Vercel's own remedy (custom domain) is free and takes an hour.
2. Vercel's underlying anycast IPs are not IP-blocked; the block is SNI/DNS and hostname-specific.
3. No current evidence that `supabase.co` is presently blocked, and Supabase's $10/mo custom-domain
   add-on removes the hostname from the browser regardless.
4. The reachability risk is entirely conditional on a fact nobody has established yet — whether any
   user is on the mainland. Re-platforming on an unverified assumption would be expensive and
   possibly pointless.
5. The only alternatives that genuinely fix mainland reachability (Options 4 and 5) require an ICP
   filing, which requires a mainland entity and mainland-hosted servers. That is a company-strategy
   decision, not an MVP hosting decision.

**The four changes:**

| # | Change | Cost | Why |
|---|---|---|---|
| 1 | Custom domain on Vercel from day one; never ship `*.vercel.app` to users | ~$12/yr | Removes the one confirmed block |
| 2 | Supabase **Custom Domain** add-on; browser never sees `*.supabase.co` | $10/mo | Halves the reachability surface; Auth + Storage move to your domain |
| 3 | Supabase region **`ap-southeast-1` (Singapore)**, Vercel functions **`sin1`** | $0 | Right for Thailand, best available for mainland; do not default to `us-east-1` |
| 4 | Client-side image compression + **direct-to-Storage signed-URL uploads** | eng time | Photos are the heaviest payload; also dodges Vercel's 4.5 MB function body limit |

**Then ask the user the one question** in [The one question](#the-one-question), and only revisit if
the answer is "yes, mainland".

**Hand to ticket 02 (WeCom auth):**
- WeCom's 可信域名 requires an MIIT-verifiable ICP filing whose entity matches the WeCom-verified
  enterprise (§3.2–3.3). A Thailand entity cannot obtain one without a mainland subsidiary or rep
  office, and filing additionally requires mainland-hosted servers (§3.4) — so it is unobtainable
  while on Vercel.
- **Group robot webhook notifications are entirely unaffected** — no domain, no filing, no IP
  whitelist (§3.5a, §4). The buildspec's notification design stands as written.
- Self-built-app **server** APIs are reachable without a filed domain via the 接收消息服务器URL route
  (§3.5b), but are gated behind the 120-address trusted-IP whitelist (§4) — which costs $100/mo on
  Vercel or ~$5/mo on a small fixed-IP VM.
- **Suggested empirical test:** have Taihue's WeCom admin attempt to add a trusted domain and
  screenshot the result. Settles §3.6 in five minutes.
- If WeCom web-OAuth login turns out to be unavailable, **change the auth design, not the hosting.**

---

## Sources

| Source | Type | Date |
|---|---|---|
| [Accessing Vercel-hosted sites from mainland China — Vercel KB](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china) | Primary (vendor) | pub. 2025-11-03, upd. 2025-11-10 |
| [`vercel.app` Blocked by SNI and DNS Pollution in China — vercel/community #803](https://github.com/vercel/community/discussions/803) | Primary (vendor repo, maintainer reply) | 2022-08-27 |
| [China project access, network access failed — Vercel Community](https://community.vercel.com/t/china-project-access-network-access-failed/10968) | Community report | 2025-05-19 |
| [Global network and regions — Vercel Docs](https://vercel.com/docs/regions) | Primary (vendor) | retrieved 2026-08-11 |
| [Static IPs — Vercel Docs](https://vercel.com/docs/networking/static-ips) | Primary (vendor) | last upd. 2026-06-30 |
| [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) | Primary (vendor) | last upd. 2026-07-01 |
| [Working with DNS — Vercel Docs](https://vercel.com/docs/domains/working-with-dns) | Primary (vendor) | last upd. 2026-06-08 |
| [Troubleshooting domains — Vercel Docs](https://vercel.com/docs/domains/troubleshooting) | Primary (vendor) | last upd. 2026-07-20 |
| [Navigating Regional Network Blocks — Supabase blog](https://supabase.com/blog/navigating-regional-network-blocks) | Primary (vendor) | 2026-03-26 |
| [(Seems) supabase api and website are blocked from China — supabase/supabase #2631](https://github.com/supabase/supabase/issues/2631) | Primary (vendor repo) | 2021-07-29 |
| [Custom Domains — Supabase Docs](https://supabase.com/docs/guides/platform/custom-domains) | Primary (vendor) | retrieved 2026-08-11 |
| [Available regions — Supabase Docs](https://supabase.com/docs/guides/platform/regions) | Primary (vendor) | retrieved 2026-08-11 |
| [Supabase Pricing](https://supabase.com/pricing) | Primary (vendor) | retrieved 2026-08-11 |
| [自建应用可信域名说明 — 企业微信帮助中心 (help2/pc/21316)](https://open.work.weixin.qq.com/help2/pc/21316) | Primary (vendor) | retrieved 2026-08-11 |
| [可信IP说明 — 企业微信帮助中心 (help2/pc/21711)](https://open.work.weixin.qq.com/help2/pc/21711) | Primary (vendor) | policy effective 2022-06-20 |
| [开发前必读 — 企业微信开发者中心 (path/90664)](https://developer.work.weixin.qq.com/document/path/90664) | Primary (vendor) | retrieved 2026-08-11 |
| [Web登录组件 — 企业微信开发者中心 (path/98152)](https://developer.work.weixin.qq.com/document/path/98152) | Primary (vendor) | retrieved 2026-08-11 |
| [接收消息与事件 概述 — 企业微信开发者中心 (path/90238)](https://developer.work.weixin.qq.com/document/path/90238) | Primary (vendor) | retrieved 2026-08-11 |
| [域名主体校验未通过 — 微信开放社区](https://developers.weixin.qq.com/community/develop/doc/000e8428bd855026640f638fc51800) | Community (vendor-hosted) | retrieved 2026-08-11 |
| [域名主体校验未通过 — 企业微信开发者社区](https://developer.work.weixin.qq.com/community/question/detail?content_id=16408877763293298820) | Community (vendor-hosted) | retrieved 2026-08-11 |
| [企业微信应用获取用户身份返回60020 — 微信开放社区](https://developers.weixin.qq.com/community/enterprisewechat/doc/00060a7c3a83304edb5e53a9c5bc00) | Community (vendor-hosted) | retrieved 2026-08-11 |
| [lyc8503/WechatPush #1 — 绕过"配置企业可信IP前…"](https://github.com/lyc8503/WechatPush/issues/1) | Community | 2022-09-29 |
| [企业微信小程序登录，错误码60020 (CSDN)](https://blog.csdn.net/LY2497935393/article/details/131595148) | Community | 2023 |
| [企业微信接入系列-自建应用 (CSDN)](https://blog.csdn.net/csdn565973850/article/details/139352173) | Community | 2024 |
| [境外企业申请ICP备案的须知与要求 — 阿里云](https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/icp-filing-application-for-enterprises-outside-the-chinese-mainland) | Primary (vendor) | retrieved 2026-08-11 |
| [Internet Content Provider (ICP) — Cloudflare China Network docs](https://developers.cloudflare.com/china-network/concepts/icp/) | Primary (vendor) | retrieved 2026-08-11 |
| [Overview — Cloudflare China Network docs](https://developers.cloudflare.com/china-network/) | Primary (vendor) | retrieved 2026-08-11 |
| [Site Acceleration Quick Start — Tencent EdgeOne](https://edgeone.ai/document/54208) | Primary (vendor) | retrieved 2026-08-11 |
| [How to Improve the Access Speed of Vercel in China — 21YunBox](https://www.21cloudbox.com/solutions/how-to-speed-up-vercel-in-china.html) | Secondary (vendor marketing — treat with caution) | retrieved 2026-08-11 |

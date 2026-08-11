# 03 — Hosting and reachability for international users

Type: research
Status: resolved
Blocked by: —

## Question

The app must work internationally — users are not guaranteed to sit in Thailand, and the workspace is WeCom, a mainland-China-operated platform whose OAuth callback must reach the deployed domain. `buildspec_1` picks Vercel + Supabase without examining whether that stack is reachable from everywhere its users are. This is cheap to check now and brutal to discover after launch.

Establish from primary and reputable sources:

1. **Vercel reachability from mainland China.** Are `*.vercel.app` domains and Vercel's edge network reliably reachable? Does a custom domain change the answer? What latency should be expected?
2. **Supabase reachability from mainland China.** The hosted Postgres, Auth, and Storage endpoints — same questions. Storage matters especially: quote photos are the heaviest payload in the app.
3. **What WeCom imposes on the domain.** Does the trusted-domain (可信域名) requirement, or WeCom's server-side API calls, require the domain to be ICP-filed or mainland-hosted? An ICP filing is a serious commitment and would reshape the hosting decision entirely — confirm whether it is actually triggered here. (Overlaps ticket 02; whichever resolves first, record the finding once and cross-link.)
4. **Fallbacks if reachability is poor.** What are the realistic options — a mainland-hosted mirror, a different host, CDN in front, or accepting degraded performance for mainland users? Cost and complexity of each, roughly.

**Output:** a findings doc at `.scratch/tender-tracker-mvp/research/03-hosting.md` with a recommendation: keep Vercel + Supabase, or change, and on what evidence.

Note: "international" was the user's word and it was not narrowed to a specific country list. If the research shows the answer hinges entirely on whether any user is on the mainland, say so plainly — that turns into a one-question follow-up rather than an open-ended hosting redesign.

## Answer

Full findings: [`research/03-hosting.md`](../research/03-hosting.md). **Recommendation: KEEP Vercel + Supabase.** The ticket bundled three problems with different answers.

**Reachability — conditional, and cheap to fix either way.** The only *confirmed* block is on `*.vercel.app`, a shared apex blocked as a unit because of other people's content (DNS pollution + SNI blocking; Vercel's underlying anycast IPs are not IP-blocked). Vercel's own remedy is a custom domain — free, an hour's work. Supabase blocking evidence is a single 2021 issue and their 2026 regional-blocks post doesn't mention China; treat as "probably degraded, no guarantee." **Everything here collapses to one unanswered question: is any actual user physically in mainland China?** Chinese-reading staff ≠ mainland-located staff, and HK/Taiwan/Singapore are outside the GFW. If no — nothing to fix. If yes — still not a re-platform, just a custom domain plus tolerating slowness.

**Four changes recommended unconditionally** (carry to `buildspec_2`): custom domain on Vercel, never ship `*.vercel.app` (~$12/yr); Supabase **Custom Domain** add-on so the browser never resolves `*.supabase.co` — moves Auth *and* Storage onto your hostname, halving the reachability surface ($10/mo, needs Pro at $25/mo); Supabase region **`ap-southeast-1` (Singapore)** with Vercel functions on `sin1` — right for Thailand, best available for southern China, and don't default to `us-east-1`; client-side image compression with **direct-to-Storage signed-URL uploads**, which also dodges Vercel's hard 4.5 MB function body limit that a modern phone photo exceeds.

**The ICP catch-22 — this is the finding that matters, and it is worse than ticket 02 knew.** ICP filing requires a mainland-registered entity (a Thai company needs a subsidiary or rep office) **and requires the servers to be in mainland China**. So "get an ICP-filed domain and keep Vercel" is not an option that exists. Combined with 02's finding that the 可信域名 must be ICP-filed under the enterprise's own entity, **WeCom web-OAuth login is effectively unavailable to Taihue** short of establishing a mainland entity and re-platforming — a different project. Confidence that the ICP rule is real: **high**. Confidence in how it applies to an org registered under a *non-mainland* entity: **low** — no official policy page exists. → the empirical test in ticket 06.

**Good news that survives:** **group robot webhooks need no domain, no filing, and no IP whitelist.** The buildspec's notification design stands as written → ticket 08. Server-side WeCom APIs are also reachable on an unfiled domain via the 接收消息服务器URL route.

**Resolves ticket 02's open uncertainty on 企业可信IP:** it is not undocumented after all — self-built apps created after **2022-06-20 20:00** *must* whitelist calling IPs (max 120, IPv4, no CIDR, third-party-provider IPs rejected). Vercel's egress is dynamic; Vercel's answer is Static IPs at **$100/month per project**. A ~$5/month fixed-IP VM in Singapore/HK does the same job and can also host the 接收消息服务器URL endpoint. Only relevant if self-built-app server APIs are used at all — webhooks are exempt.

**Honest gaps:** no test from inside China was possible — if the answer to the one question is "yes, mainland," one person opening a test deployment settles it faster than more research.

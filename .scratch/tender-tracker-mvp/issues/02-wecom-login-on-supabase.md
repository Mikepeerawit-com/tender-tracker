# 02 — What WeCom login on Supabase actually requires

Type: research
Status: resolved
Blocked by: —

## Question

`buildspec_1` asserts WeCom login will be "implemented as a custom OAuth 2.0 provider, since Supabase has no built-in WeCom connector." This is the least-verified claim in the document: Supabase Auth exposes a fixed list of social providers and has historically had **no generic/custom OAuth provider slot** you can point at an arbitrary endpoint. If that is still true, the spec's login section describes something that cannot be built as written, and the fix is not a small one.

Establish from primary sources (Supabase docs/GitHub, WeCom 企业微信 developer docs — not blog posts):

1. **What Supabase actually offers** for a provider it does not natively support. Enumerate the real mechanisms and their constraints: `signInWithIdToken`, the custom access token / auth hook, Admin API `createUser` + `generateLink`, third-party-auth / external JWT issuer support, or abandoning Supabase Auth for the WeCom path while keeping it for email/password. For each: does it let you mint a genuine Supabase session from an externally-verified identity, and what does it cost to build?
2. **What WeCom's OAuth web login actually returns.** The 网页授权 / OAuth2 flow: authorize URL → `code` → `access_token` → user info. Critically: what identifiers come back (`userid`, `openid`), and is an **email address ever available**? Supabase Auth is email-centric; if WeCom yields no email, that shapes the whole integration.
3. **Trusted domain (可信域名) and network requirements.** What verification does WeCom demand of the callback domain — a hosted verification file, an ICP filing, an IP allowlist for API calls? Does any of it conflict with serverless hosting where egress IPs are not stable?
4. **Self-built app (自建应用) vs verified organisation.** Does the login flow work with a self-built app alone, or does something in the chain require org verification?

**Output:** a findings doc at `.scratch/tender-tracker-mvp/research/02-wecom-login.md` naming the concrete integration path, the work it implies, and anything that makes it impossible. Cite sources. Where the docs are Chinese-language, quote the original alongside the translation — this is exactly where paraphrase loses the constraint that matters.

Note: assistant knowledge of Supabase's provider list may be stale. Verify against current docs rather than recalling.

## Answer

Full findings: [`research/02-wecom-login.md`](../research/02-wecom-login.md) — sourced to current Supabase docs, the `supabase/auth` (GoTrue) source at commit `713a0d9`, and official 企业微信 developer docs.

**`buildspec_1`'s claim is MISLEADING, and this ticket's own premise was stale.**

1. **Supabase *does* now have a generic slot.** Custom OAuth/OIDC Providers shipped in `auth` v2.187.0 (2026-02-23), GA 2026-04-08. This ticket was written on the assumption it didn't exist.
2. **It doesn't help, because WeCom is not a standards-compliant OAuth 2.0 provider.** WeCom has **no token endpoint**. Its `access_token` is app-scoped (from `corpid`+`corpsecret`), not user-scoped, and the `code` is redeemed at the *userinfo* endpoint as a query param — while Supabase's `config.Exchange()` POSTs to a token URL that doesn't exist and then sends `Authorization: Bearer`. WeCom also signals errors as HTTP 200 with a non-zero `errcode`, which Supabase reads as success. Points 1–3 of that list are structural: **no configuration of Supabase's custom OAuth2 provider can talk to WeCom directly.**
3. **`buildspec_1` is also internally inconsistent** — its step 3 ("look up/create matching row in `users` → issue app session") describes *bypassing* Supabase Auth, which is a different architecture from "a custom OAuth 2.0 provider". It asserts both.

**Recommended path:** a WeCom→OIDC shim (~300–500 LOC, 6 endpoints) registered as a Supabase custom **OIDC** provider — OIDC specifically because `signInWithIdToken` accepts `custom:` providers but rejects OAuth2-type ones. Mints a genuine session with a real `auth.identities` row. **Cheaper fallback:** skip OAuth entirely — verify WeCom server-side, then `admin.createUser` + `generateLink('magiclink')` + `verifyOtp` with a synthetic email (~0.5 day, no `identities` row).

**Email: treat as absent.** `auth/getuserinfo` returns only `userid`. Email requires a second `getuserdetail` call gated on `scope=snsapi_privateinfo` (manual consent *every* login), plus admin-selected sensitive fields, plus the field actually being populated in the directory. Key identity on `wecom_userid`; set `email_optional: true`. There is **no `unionid`** in WeCom member APIs — that's a consumer-WeChat concept.

**The real blocker is administrative, not technical.** Engineering is 1–2 days. But the 可信域名 must be **ICP-filed, 工信网-findable, and 备案'd under Taihue's own entity** — so `*.vercel.app` is unusable (buildspec step 2 is impossible as written). Configuring a trusted domain at all requires an **已验证/认证** WeCom org. ICP 备案 is weeks; org 认证 is days–weeks plus RMB 300+. None of this is on the buildspec's plan, and it binds *every* option above — including the cheap fallback, since the callback and `gettoken` are WeCom's problem, not Supabase's.

**Handed to other tickets:** error 60020 (不安全的访问IP) requires calling-server IPs in 企业可信IP, and WeCom rejects IPs it identifies as third-party providers — a direct conflict with Vercel's ephemeral egress. Whether it's enforced for a fresh 自建应用 is undocumented and needs an empirical test → tickets 03 and 06. Taihue's current org-verification state and whether an ICP-filed domain exists → ticket 06.

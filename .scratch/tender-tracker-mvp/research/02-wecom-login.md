# 02 — What WeCom login on Supabase actually requires

Research for ticket `issues/02-wecom-login-on-supabase.md`. Verified against Supabase docs, the
`supabase/auth` (GoTrue) source at commit `713a0d9`, and the official 企业微信 developer
documentation. Date of research: 2026-08-11.

---

## Verdict on `buildspec_1`

> "**WeCom login (for Taihue)** — implemented as a custom OAuth 2.0 provider, since Supabase has no
> built-in WeCom connector"
> (`tender-tracker-buildspec_1.md`, "Auth" section, line 49)

**MISLEADING** — and the ticket's own premise is now **stale** too. Three separate corrections:

1. **The ticket is wrong that Supabase has no generic OAuth slot.** It does now. Supabase shipped
   **Custom OAuth/OIDC Providers** in `auth` v2.187.0 (2026-02-23), GA-announced 2026-04-08. This
   invalidates the ticket's framing.
2. **But the buildspec is still wrong in practice**, because WeCom is *not* a standards-compliant
   OAuth 2.0 provider. It has **no token endpoint**. You cannot point Supabase's custom OAuth2
   provider at WeCom's URLs and have it work — the flow breaks at step one of the exchange. A shim
   is mandatory. See [§2](#2-wecom-is-not-an-oauth-20-provider-the-decisive-finding).
3. **The buildspec is internally inconsistent.** Its own step 3 — "look up/create matching row in
   `users` table → issue app session" — describes *bypassing* Supabase Auth entirely. That is a
   different architecture from "a custom OAuth 2.0 provider", and the bullet asserts both.

Separately, buildspec step 2 — "Set trusted domain (可信域名) to the app's deployed domain
(Vercel)" — is **very likely impossible as written**. See [§4](#4-trusted-domain-可信域名--the-real-blocker).

---

## 1. What Supabase actually offers today

### 1a. Custom OAuth/OIDC Providers — REAL, GA, and the right primitive

Source: <https://supabase.com/docs/guides/auth/custom-oauth-providers>,
announcement <https://supabase.com/blog/custom-oauth-oidc-providers> (2026-04-08),
`CHANGELOG.md` in <https://github.com/supabase/auth> — `2.187.0` (2026-02-23):
`* support custom oauth & oidc providers (#2357)`.

> "Custom OAuth/OIDC providers let you integrate any standards-compliant identity provider with
> Supabase Auth, beyond the ones Supabase supports out of the box."

Two provider types:

- **`oauth2`** — you supply `authorization_url`, `token_url`, `userinfo_url`, `client_id`,
  `client_secret`, `scopes` manually.
- **`oidc`** — you supply an `issuer`; discovery/JWKS/endpoints resolve from
  `{issuer}/.well-known/openid-configuration`.

Key properties verified from docs + source:

| Property | Value | Source |
|---|---|---|
| Identifier | must start with `custom:` (2–50 chars, lowercase alnum + `-` `:`) | docs |
| Plan limits | "Free plan projects can add up to 3 custom providers. Pro plan and above have unlimited custom providers." | docs |
| PKCE | `pkce_enabled: true` by default, handled server-side | docs |
| Email | "By default, providers must return an email address. Set `email_optional` to `true` … to allow sign-in without an email. This applies to both OAuth2 and OIDC providers." | docs |
| Attribute mapping | supported — `attribute_mapping` remaps source claim names onto Supabase's `Claims` struct | `internal/api/provider/custom_oauth.go` `applyAttributeMapping` |
| Custom claims | `custom_claims_allowlist` copies arbitrary keys verbatim into `custom_claims` | same file, `captureAllowedClaims` |
| Client call | `supabase.auth.signInWithOAuth({ provider: 'custom:my-provider' })` | docs |

**This mints a genuine Supabase session** (row in `auth.users`, row in `auth.identities`, access +
refresh tokens, works with RLS `auth.uid()`). It is the only mechanism in this list that does so
through a *real* provider identity.

Also verified: `signInWithIdToken` **does** accept `custom:` providers, but **only OIDC ones**
(`internal/api/token_oidc.go`):

```go
case strings.HasPrefix(p.Provider, "custom:"):
    ...
    // Ensure it's an OIDC provider
    if !customProvider.IsOIDC() { ... "Provider %q is not an OIDC provider" }
```

So an OIDC shim gives you *both* the redirect flow and the ID-token flow. An OAuth2-manual shim
gives you only the redirect flow.

### 1b. `signInWithIdToken` (built-in) — NO

Hard-coded provider list in `internal/api/token_oidc.go`: Apple, Google, Azure, Facebook, Keycloak,
Kakao, Vercel Marketplace, Snapchat. Plus `custom:` OIDC providers (see above). The legacy
"arbitrary issuer" path is explicitly deprecated:

```go
default:
    log...Warn("Use of POST /token with arbitrary issuer and client_id is deprecated for
    security reasons. Please switch to using the API with provider only!")
```

and gated behind an `AllowedIdTokenIssuers` allowlist that is not user-configurable on hosted
Supabase. WeCom issues no ID token anyway.

### 1c. Custom access token hook — NO (cannot authenticate)

<https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook>. The hook "runs before
a token is issued and allows you to add additional claims based on the authentication method used."
It receives an **already-authenticated** user and returns modified claims. It cannot create a
session or verify an external identity. Useful *later* for stamping `wecom_userid` into the JWT;
useless as a login mechanism.

### 1d. Third-party auth / external JWT issuer — NO

<https://supabase.com/docs/guides/auth/third-party/overview>. Fixed list: **Clerk, Firebase Auth,
Auth0, AWS Cognito, WorkOS**. No arbitrary-JWKS registration. Also: "It is not possible to disable
Supabase Auth at this time." Not applicable to WeCom.

### 1e. Admin API `createUser` + `generateLink` — YES, but with a synthetic email

<https://supabase.com/docs/reference/javascript/auth-admin-generatelink>. Types: `signup`,
`magiclink`, `invite`, `recovery`, `email_change_current`, `email_change_new` — **all require an
email address**. Flow: server verifies the WeCom identity → `admin.createUser()` (or find existing)
→ `admin.generateLink({ type: 'magiclink', email })` → take `hashed_token` from the response →
client calls `verifyOtp({ type: 'magiclink', token_hash })` → genuine session.

This *does* mint a real Supabase session. Costs: you must invent an email
(`{wecom_userid}@wecom.taihue.invalid`) when WeCom gives you none, and you must make sure nobody can
log in as that synthetic address by requesting their own magic link (disable email signups /
password grant for that domain, or keep the address on a domain you control and never deliver to).

### 1f. Bypass Supabase Auth for the WeCom path — POSSIBLE, NOT RECOMMENDED

Sign your own JWT with the project's JWT secret so PostgREST accepts it. You lose: refresh-token
rotation, session revocation, MFA, `auth.users` as the single user table, and you couple yourself to
Supabase's JWT signing scheme at exactly the moment Supabase is migrating projects to asymmetric
JWT signing keys. This is what buildspec step 3 literally describes. Avoid.

### Summary table

| Mechanism | Mints a real Supabase session? | Build cost | Verdict |
|---|---|---|---|
| Custom OAuth2 provider pointed straight at WeCom | — | — | **Impossible** (§2) |
| Custom **OIDC** provider + self-hosted WeCom→OIDC shim | Yes, with a real `identities` row | ~1–2 days | **Recommended** |
| `signInWithIdToken` (built-in providers) | n/a | — | Not applicable |
| Custom access token hook | No — post-auth only | — | Not a login path |
| Third-party auth (external JWT issuer) | n/a | — | Fixed 5-provider list |
| Admin `createUser` + `generateLink` + `verifyOtp` | Yes, via synthetic email | ~0.5 day | **Viable MVP fallback** |
| Bypass Supabase Auth, self-signed JWT | Not a Supabase session | ~1 day + ongoing risk | Avoid |

---

## 2. WeCom is not an OAuth 2.0 provider (the decisive finding)

WeCom's flow *looks* like OAuth2 at the authorize step and then diverges completely.

**Step 1 — authorize** (<https://developer.work.weixin.qq.com/document/path/91022>):

```
https://open.weixin.qq.com/connect/oauth2/authorize?appid=CORPID&redirect_uri=REDIRECT_URI
  &response_type=code&scope=snsapi_base&state=STATE&agentid=AGENTID#wechat_redirect
```

- `appid` — 企业的CorpID ("the enterprise's CorpID")
- `scope=snsapi_base` — 静默授权，可获取成员的基础信息（UserId）
  ("silent authorization, obtains the member's basic info (UserId)")
- `scope=snsapi_privateinfo` — 手动授权，可获取成员的详细信息，包含头像、二维码等敏感信息
  ("manual authorization, obtains the member's detailed info including avatar, QR code and other
  sensitive information") — `agentid` is 必填 (required) for this scope
- Redirects to `redirect_uri?code=CODE&state=STATE`; code长度最大为512字节, single-use, 5-minute expiry.

**Step 2 — there is no token endpoint.** The app-level credential is fetched *separately and
out-of-band* (<https://developer.work.weixin.qq.com/document/path/91039>):

```
GET https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=ID&corpsecret=SECRET
→ { "errcode":0, "errmsg":"ok", "access_token":"...", "expires_in":7200 }
```

> 开发者 **请勿** 将 access_token 返回给前端
> ("developers **must not** return the access_token to the frontend")

and 不能频繁调用gettoken接口，否则会受到频率拦截 ("do not call gettoken frequently or you will be
rate-limited") — the token must be cached across requests.

**Step 3 — the code is redeemed at the *userinfo* endpoint**
(<https://developer.work.weixin.qq.com/document/path/91023>):

```
GET https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=ACCESS_TOKEN&code=CODE
```

Enterprise member response: `{ errcode, errmsg, userid, user_ticket, user_doc_ticket }`.
Non-member response: `{ errcode, errmsg, openid, external_userid }`.

### Why Supabase's custom OAuth2 provider cannot consume this

From `internal/api/provider/custom_oauth.go` and `provider.go` (commit `713a0d9`):

```go
func (p *CustomOAuthProvider) GetOAuthToken(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	return p.config.Exchange(ctx, code, opts...)   // golang.org/x/oauth2 — POST token_url,
}                                                  // grant_type=authorization_code

func makeRequest(ctx context.Context, tok *oauth2.Token, g *oauth2.Config, url string, dst interface{}) error {
	client := g.Client(ctx, tok)                   // sends Authorization: Bearer <access_token>
	res, err := client.Get(url)                    // plain GET, no extra query params
	...
}
```

Six concrete incompatibilities:

1. **No token endpoint exists.** `config.Exchange` POSTs `grant_type=authorization_code&code=…` to
   `token_url`. WeCom has no such URL. There is nothing to put in the `Token URL` field.
2. **The `access_token` is app-scoped, not user-scoped.** It is derived from `corpid`+`corpsecret`
   and identifies the *application*, not the logged-in member. OAuth2 semantics do not apply.
3. **The `code` is consumed at userinfo, not at the token endpoint.** Supabase discards the code
   after the (nonexistent) exchange and calls userinfo with only a bearer token — so the code would
   never reach `auth/getuserinfo`.
4. **Userinfo auth style is wrong.** Supabase sends `Authorization: Bearer …`; WeCom requires
   `?access_token=…` as a query parameter and ignores the header.
5. **Error signalling is wrong.** WeCom returns HTTP 200 with a non-zero `errcode` in the body.
   Supabase's `makeRequest` only treats non-2xx as failure, so WeCom errors would parse as an empty
   successful user.
6. **No standard claims.** WeCom returns `userid`, never `sub`. Supabase reads
   `userData.Metadata.Subject` for identity linking
   (`internal/api/external.go:304` → `models.DetermineAccountLinking(..., userData.Metadata.Subject)`).
   `attribute_mapping` could remap `userid → sub`, but only if points 1–5 were solved first.

Points 1–3 are structural. **No configuration of Supabase's custom OAuth2 provider can talk to
WeCom directly.**

### Is an email ever available?

**Not from the login call.** `auth/getuserinfo` returns no email field — for either the legacy
网页授权 flow (path/91023) or the newer 企业微信登录 flow (path/98176; same endpoint).

**Yes, conditionally, from a second call.**
<https://developer.work.weixin.qq.com/document/path/96443> — 获取访问用户敏感信息:

```
POST https://qyapi.weixin.qq.com/cgi-bin/auth/getuserdetail?access_token=ACCESS_TOKEN
body: { "user_ticket": "USER_TICKET" }
→ { errcode, errmsg, userid, gender, avatar, qr_code, mobile, email, biz_mail, address }
```

Three gates, all of which must hold:

1. `user_ticket` is only returned by `auth/getuserinfo` when the authorize call used
   **`scope=snsapi_privateinfo`** — i.e. 手动授权 (manual authorization). The user sees a consent
   screen every time; there is no silent path to email.
2. 敏感字段需要管理员在应用详情里选择，且成员oauth2授权时确认后才返回
   ("sensitive fields must be selected by the administrator in the app details, and are only
   returned after the member confirms during OAuth2 authorization"). 邮箱 (email) and 企业邮箱
   (biz_mail) are both on the sensitive list.
3. The field must actually be **populated in Taihue's WeCom directory**. Many organisations never
   fill in member email addresses. `biz_mail` only exists if Taihue uses Tencent Exmail — which
   `buildspec_1`'s "Email" section says is *not yet decided*.

**Planning consequence:** treat email as **absent**. The stable, always-present identifier is
`userid` (a per-corp string, stable within Taihue's WeCom). `open_userid` is the corp-scoped opaque
form. There is **no `unionid`** in the WeCom (企业微信) member APIs — `unionid` is a consumer-WeChat
(开放平台) concept and does not appear in `auth/getuserinfo`. `openid`/`external_userid` come back
only when the authorizing person is *not* a member of the enterprise, which for this use case is a
rejection case, not an identity to store.

So: set `email_optional: true` on the custom provider, or synthesise an address in the
`generateLink` fallback. Key the app's user identity on `wecom_userid`.

---

## 3. Which WeCom login flow works in a desktop browser

This matters and the buildspec doesn't distinguish them.

- **网页授权 / OAuth2** (`open.weixin.qq.com/connect/oauth2/authorize`, path/91022) is the in-client
  flow — designed for pages opened from within the WeCom app.
- **企业微信登录 / Web 登录组件** (path/98151, path/98152) is the browser flow. Embedded via
  `@wecom/jssdk` (≥2.3.2), renders a QR code panel **inside your own site** (no redirect to a WeCom
  domain), with `login_type: 'CorpApp'`, `appid` = CorpID, `agentid`, `redirect_uri`, `state`. On
  Win/Mac with the WeCom desktop client v3.1.23+ running it upgrades to one-click "quick login" in
  Chrome/Firefox/Edge.

Both terminate at the same `auth/getuserinfo?access_token=…&code=…` redemption, so §2 applies
identically. A desktop-first internal tool wants the **Web 登录组件**, and its host page domain is
also subject to the trusted-domain rule below.

path/98151 states: 跳转的域名须完全匹配access_token对应应用的可信域名 ("the redirect domain must
exactly match the trusted domain of the app corresponding to the access_token"), otherwise error
50001.

---

## 4. Trusted domain (可信域名) — the real blocker

Source: <https://open.work.weixin.qq.com/help2/pc/21316> (自建应用可信域名说明) and
<https://developer.work.weixin.qq.com/document/path/90514>.

Direct quotes:

> 所有的JS接口只能在企业微信应用的可信域名下调用(包括子域名)，且**可信域名必须有ICP备案且在管理端验证域名归属**。
> ("All JS interfaces may only be called under the WeCom app's trusted domain (including
> subdomains), and **the trusted domain must have an ICP filing and its ownership must be verified
> in the admin console**.")

> 设置的可信域名，不能包含协议头，不支持IP地址及短链域名，也不支持带下划线的域名
> ("the trusted domain must not include a protocol prefix; IP addresses, short-link domains, and
> domains containing underscores are not supported")

> 配置可信域名必须要有主体，**需已验证/认证企业才可操作**
> ("configuring a trusted domain requires a legal entity; **only a verified/certified enterprise can
> do it**")

> 绑定在应用中的可信域名需**工信网上可查**到
> ("the trusted domain bound to the app must be **findable on the MIIT [工信部] registry**")

Also from the help doc: 每个二级域名需要做归属校验，需要将校验文件放到域名根目录下 — each
second-level domain needs an ownership check, with a `WW_verify_[校验码].txt` file served from the
domain root (e.g. `http://example.com/WW_verify_xxx.txt`), and **the file must not be deleted
afterwards**. Limits: **OAuth2.0回调域名仅支持1个** (exactly one OAuth2 callback domain per app);
JS-SDK trusted domains max 10. Exact match only — no wildcards; if the URL has a port, the port must
be registered too (path/91335: `mail.qq.com:8080`, not `mail.qq.com`).

Error 50001 = `redirect_url未登记可信域名`
(<https://developer.work.weixin.qq.com/document/path/90313>).

### Consequence for `buildspec_1` step 2

"Set trusted domain (可信域名) to the app's deployed domain (Vercel)" — a `*.vercel.app` hostname
**cannot** be registered:

- it has no ICP 备案 and is not 工信网可查;
- its registration entity is Vercel Inc., not Taihue, and post-security-upgrade WeCom requires the
  domain's 备案主体 to match (or be related to) the enterprise's WeCom-verified entity.

**Taihue must supply their own ICP-filed domain**, filed under Taihue's own entity, and serve the
`WW_verify_*.txt` file from its root. This requirement is independent of which Supabase mechanism
you pick — it binds every option in §1.

### Trusted IP (企业可信IP) and serverless egress

Error 60020 = 不安全的访问IP ("insecure access IP")
(<https://developer.work.weixin.qq.com/document/path/90313>):

> 自建应用或通讯录同步助手：请确认该IP是本企业服务器IP，并已经配置到应用详情的"企业可信IP"项目中
> ("Self-built app or directory-sync assistant: confirm the IP is this enterprise's server IP and
> has been configured in the app details' '企业可信IP' field")

Configuration takes effect after ~1 minute, and WeCom rejects IPs that it identifies as belonging to
a third-party service provider.

**This conflicts directly with Vercel serverless functions**, whose egress IPs are ephemeral and
shared, and which WeCom would plausibly classify as third-party infrastructure. If 60020 is
triggered for this app, `gettoken` and `auth/getuserinfo` must be called from a host with a stable,
enterprise-attributable egress IP.

*(Overlaps ticket 03 — noted and moving on. Ticket 03 should own the "where does server-side code
that talks to Chinese APIs actually run" question, because the answer here — an ICP-filed domain
plus a stable egress IP — is very likely a small mainland-China VM rather than Vercel.)*

---

## 5. Self-built app (自建应用) vs org verification

**A 自建应用 is sufficient for the login mechanics** — CorpID + AgentID + Secret, `scope=snsapi_base`
or `snsapi_privateinfo`, `auth/getuserinfo`. No third-party service-provider (服务商) registration
and no app marketplace review is needed.

**But org verification is required one step upstream.** You cannot configure the 可信域名 without it:

> 配置可信域名必须要有主体，需已验证/认证企业才可操作

and without a trusted domain, `redirect_uri` fails with error 50001, so **there is no login flow at
all**. So the chain is: 企业验证/认证 → 可信域名 → OAuth callback → login.

WeCom distinguishes 企业验证 (identity verification) from 企业认证 (paid certification). The help
text accepts **either** (已验证/认证). For 认证 specifically:
<https://open.work.weixin.qq.com/help2/pc/19734> gives a review fee of **RMB 300 per application**
(third-party auditor) plus a member-size fee, with annual review.

**Action item for Taihue:** confirm which state their WeCom org is already in. Most established
Chinese companies using WeCom seriously are already 已验证 or 已认证, in which case this is a
non-issue. If they are not, this is a prerequisite with a lead time (materials + third-party review),
not a code task.

---

## 6. Recommended integration path

### Primary: a WeCom→OIDC shim registered as a Supabase custom OIDC provider

```
Browser (Vercel app)
  └─ supabase.auth.signInWithOAuth({ provider: 'custom:wecom' })
       └─ Supabase Auth  →  https://auth.taihue.cn/authorize          [SHIM]
            └─ redirect / Web 登录组件  →  WeCom, user scans or quick-logs-in
                 └─ WeCom  →  https://auth.taihue.cn/callback?code=…  [SHIM, the 可信域名]
                      ├─ GET /cgi-bin/gettoken (cached ≤7200s)
                      ├─ GET /cgi-bin/auth/getuserinfo?access_token&code   → userid
                      └─ (optional) POST /cgi-bin/auth/getuserdetail       → email, avatar
                 └─ shim mints its own code, redirects to Supabase callback
       └─ Supabase POSTs /token  →  shim returns a signed OIDC ID token (sub = wecom userid)
       └─ Supabase GETs /userinfo (Bearer)  →  { sub, name, picture, email? }
  └─ genuine Supabase session: auth.users row + auth.identities row, RLS via auth.uid()
```

Why OIDC-type and not OAuth2-manual: OIDC gives you discovery (one `issuer` field to configure
instead of three URLs) *and* unlocks `signInWithIdToken({ provider: 'custom:wecom' })` for a future
mobile/in-WeCom-client path, which OAuth2-manual does not
(`internal/api/token_oidc.go`: "Provider %q is not an OIDC provider").

The shim is 6 endpoints:

| Endpoint | Job |
|---|---|
| `GET /.well-known/openid-configuration` | static discovery doc |
| `GET /.well-known/jwks.json` | RSA public key with a `kid` |
| `GET /authorize` | validate `client_id`/`redirect_uri`, stash state+PKCE, bounce to WeCom |
| `GET /callback` | **the WeCom 可信域名 target**; redeem WeCom code, mint own code, bounce to Supabase |
| `POST /token` | RFC 6749: validate code + client_secret + PKCE verifier → ID token + access token |
| `GET /userinfo` | Bearer → claims |

Supabase config (`email_optional: true`, since email is not guaranteed):

```
identifier:    custom:wecom
provider_type: oidc
issuer:        https://auth.taihue.cn
client_id / client_secret:  invented by you, shared with the shim
email_optional: true
scopes:        ['openid', 'profile']
```

### Fallback if the shim is judged too much for the MVP

Skip Supabase's OAuth machinery entirely and use §1e: do the WeCom dance in a server route, then
`admin.createUser({ email: '{userid}@wecom.taihue.internal', email_confirm: true, user_metadata: { wecom_userid } })`
→ `admin.generateLink({ type: 'magiclink' })` → `verifyOtp({ token_hash })`. Real session, no OIDC
plumbing, ~a third of the code. Costs: synthetic emails in `auth.users`, no `auth.identities` row for
WeCom, and you must lock down that email domain against self-service login.

**Note that this fallback does not avoid §4.** The WeCom callback still lands on a trusted domain and
`gettoken` still comes from a server IP. The domain and IP problems are WeCom's, not Supabase's.

---

## 7. Cost to build

| Item | Estimate | Notes |
|---|---|---|
| WeCom→OIDC shim (6 endpoints, RSA keypair, code store, token cache) | **1–2 days** | ~300–500 LOC; no library does this for WeCom |
| Hosting for the shim on an ICP-filed domain | **0.5 day** + infra cost | Small mainland VM; see ticket 03 |
| Supabase custom provider config + client wiring | **1–2 hours** | Dashboard or Admin API |
| Mapping `wecom_userid` → app user, org membership check | **0.5 day** | `user_metadata` + a `wecom_userid` column |
| `generateLink` fallback instead of the shim | **~0.5 day** | Replaces the first two rows |
| **ICP 备案 for the domain (if Taihue lacks one)** | **weeks, not days** | Administrative, blocking, outside eng control |
| **企业验证/认证 (if not already done)** | **days–weeks**, RMB 300+ if 认证 | Administrative, blocking |

Engineering is small. **The critical path is administrative**, and none of it is on the buildspec's
current plan.

---

## 8. What is impossible or blocked

1. **Pointing Supabase's custom OAuth2 provider directly at WeCom.** Structurally impossible — no
   token endpoint (§2). Any plan that says "configure WeCom as a custom OAuth provider" without a
   shim is dead.
2. **Using a `*.vercel.app` domain as the WeCom 可信域名.** No ICP filing, wrong 备案主体 (§4).
3. **Getting an email address silently.** Requires `snsapi_privateinfo` (manual consent), admin
   configuration of sensitive fields, *and* the field being populated in the directory (§2).
4. **Registering WeCom as a Supabase third-party auth issuer.** Fixed 5-provider list (§1d).
5. **Doing any of this without org verification.** 可信域名 configuration requires 已验证/认证
   enterprise (§5).

## 9. What remains uncertain

1. **Whether 企业可信IP is actually enforced for this app.** Error 60020 is documented as a real
   failure mode for 自建应用, but the docs do not state that every `gettoken`/`getuserinfo` call from
   a fresh self-built app requires an allowlisted IP. Must be tested empirically. If it is enforced,
   Vercel serverless is disqualified for the WeCom API calls. **→ ticket 03.**
2. **Whether an ICP-filed domain CNAME'd to Vercel passes WeCom's checks.** WeCom's stated checks are
   a 工信网 lookup (a property of the *domain*) plus a `WW_verify_*.txt` file at the root (servable
   from Vercel). On the letter of the rules this might pass; pointing a 备案'd domain at
   offshore hosting is separately a 备案 compliance problem. Needs an empirical test before the
   architecture is committed.
3. **`user_ticket` validity window.** path/96443 does not state it in the fetched content. The shim
   must call `getuserdetail` immediately after `getuserinfo` rather than deferring.
4. **Taihue's current WeCom org state** (未验证 / 已验证 / 已认证) and whether member emails are
   populated in their directory. Both are questions for the client, not for docs.
5. **Whether `email_optional: true` users are fully functional** across every Supabase Auth surface
   (e.g. account linking, email-change flows). Docs state the flag exists and what it does, but not
   the downstream behaviour of an email-less `auth.users` row.

---

## Sources

Supabase:
- <https://supabase.com/docs/guides/auth/custom-oauth-providers>
- <https://supabase.com/blog/custom-oauth-oidc-providers> (2026-04-08)
- <https://supabase.com/docs/guides/auth/social-login>
- <https://supabase.com/docs/guides/auth/third-party/overview>
- <https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook>
- <https://supabase.com/docs/reference/javascript/auth-admin-generatelink>
- <https://github.com/supabase/auth> @ `713a0d9` — `internal/api/provider/custom_oauth.go`,
  `internal/api/provider/provider.go`, `internal/api/token_oidc.go`, `internal/api/external.go`,
  `CHANGELOG.md`

企业微信:
- <https://developer.work.weixin.qq.com/document/path/91022> — 构造网页授权链接
- <https://developer.work.weixin.qq.com/document/path/91023> — 获取访问用户身份
- <https://developer.work.weixin.qq.com/document/path/91039> — 获取access_token
- <https://developer.work.weixin.qq.com/document/path/96443> — 获取访问用户敏感信息
- <https://developer.work.weixin.qq.com/document/path/98151> — 企业微信登录（Web）
- <https://developer.work.weixin.qq.com/document/path/98152> — Web登录组件
- <https://developer.work.weixin.qq.com/document/path/98176> — 获取登录用户信息
- <https://developer.work.weixin.qq.com/document/path/91335> — 开始开发（可信域名匹配规则）
- <https://developer.work.weixin.qq.com/document/path/90514> — JS-SDK 开始使用（ICP备案要求）
- <https://developer.work.weixin.qq.com/document/path/90313> — 全局错误码（50001, 60020, 40001）
- <https://open.work.weixin.qq.com/help2/pc/21316> — 自建应用可信域名说明
- <https://open.work.weixin.qq.com/help2/pc/19734> — 认证费用与年审

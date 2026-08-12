# 13 — The two WeCom console gates QR login depends on

Findings for [issue #14](https://github.com/Mikepeerawit-com/tender-tracker/issues/14).
Measured 2026-08-12. **No credentials in this file** — those live in `.env` at the
repo root (gitignored). Public egress IP redacted throughout, per ticket 06's
precedent.

| Test | Question | Result |
|---|---|---|
| **A** | Does **Authorized callback domain** carry the filing-entity gate? | ⚠️ **Open** — console work, not yet run |
| **B** | Is `auth/getuserinfo` exempt from **Trusted enterprise IP**? | ❌ **Settled — NOT exempt** |
| **C** | Can Trusted enterprise IP be unlocked via **Receive messages server URL**? | ⚠️ **Open** — promoted to required by B's failure |

---

## Test B — `auth/getuserinfo` is NOT exempt from Trusted enterprise IP

**Result: 60020. The QR-login code→userid exchange needs a fixed egress IP.**

### The shortcut, and why it is honest

The ticket assumed this test needed a real login `code`, and therefore that it was
blocked behind Test A and a throwaway host. It is not. The ticket's own decision
rule already contained the escape:

> `60020` = a fixed egress IP is required. Anything else (including `40029`
> invalid/expired code) = exempt, **because 60020 is checked before the code is**.

If that ordering holds, a *deliberately invalid* code discriminates the two outcomes
exactly as well as a real one. So the ordering was verified first, as a control,
rather than assumed.

### Method

Three calls from an ordinary machine, **Trusted enterprise IP still empty**, using
the `.env` app credentials. `gettoken` first (confirmed still exempt, `errcode 0`).

| # | Call | Purpose | errcode |
|---|---|---|---|
| 1 | `/cgi-bin/gettoken` | Baseline — known exempt | **0** |
| 2 | `/cgi-bin/user/get?userid=ZZZ_NO_SUCH_USER_ZZZ` | **Control** — known non-exempt endpoint, deliberately invalid parameter | **60020** |
| 3 | `/cgi-bin/auth/getuserinfo?code=ZZZ_NOT_A_REAL_CODE_ZZZ` | **The test** | **60020** |
| 4 | `/cgi-bin/department/list` | Replicates ticket 06 §9 | **60020** |

Error body on 2, 3 and 4:

```
not allow to access from your ip, hint: [...], from ip: <redacted>
more info at https://open.work.weixin.qq.com/devtool/query?e=60020
```

### Why the control settles it

Call 2 is the load-bearing one. `user/get` with a userid that cannot exist returned
**60020**, not `60111` (userid not found) or any parameter error. **The IP gate fires
before parameter validation.** Therefore call 3's 60020 is a genuine IP-gate result
and not an artifact of the invalid code — the request never got far enough for the
code to be looked at.

Without call 2 this test would have been unreadable, since 60020 on a bogus code
could otherwise have been argued either way.

### The result does not depend on which endpoint QR login actually uses

A fair objection to the above: the ticket and ADR-0006 both *assume* the QR flow
redeems its `code` at `auth/getuserinfo`. If it used some other endpoint, Test B would
have measured the wrong thing.

The documentation could not be consulted to settle this — `developer.work.weixin.qq.com`
is blocked to the browser tooling, and its doc pages are Vue SPAs whose body loads
async, so `curl` returns a 1.2 MB shell containing no documentation text. Rather than
infer, the question was closed empirically by sweeping **every endpoint the flow could
plausibly use**:

| Endpoint | errcode |
|---|---|
| `auth/getuserinfo` | **60020** |
| `auth/getuserdetail` | **60020** |
| `user/getuserinfo` (legacy alias) | **60020** |
| `service/get_login_info` | **60020** |
| `gettoken` (control) | **0** |

**The whole `auth/*` family is gated.** `gettoken` remains the only exemption found
across nine distinct endpoints now tested between this ticket and ticket 06. So the
conclusion holds whichever endpoint the QR flow turns out to call, and identifying it
precisely is a `buildspec_2` implementation detail rather than a gate on this decision.

### The official docs are wrong here

The WeCom documentation for `auth/getuserinfo` lists only `40029` and `50001` as
error codes, never `60020`. That absence was the entire basis for hoping the endpoint
sat in the exempt set with `gettoken`. **It does not.** Treat the published error
lists as incomplete: the IP gate is applied at a layer above the endpoint and is not
reflected in per-endpoint documentation.

### Consequences

- **QR login cannot be completed on Vercel serverless.** The `code` → `wecom_userid`
  exchange is a server-side call and it is IP-gated, exactly like every other business
  API in ticket 06 §9. There is no zero-cost path.
- Per [ADR-0006](../adr/0006-email-password-floor-wecom-convenience.md)'s decision rule,
  B failing means the choice is **~$2/mo Fly.io dedicated IPv4 + small proxy** vs the
  **zero-cost fallback** (drop QR login; the group robot posts the invite link into
  the WeCom group). **That choice is not made here** — it is worthless until Test A
  reports, because if A fails there is nothing to buy an IP *for*.
- `gettoken`'s exemption is re-confirmed, and remains a trap: it returns `0` and makes
  the constraint look absent. Ticket 06 already recorded this; it caught a second
  session out and is worth restating in `buildspec_2`.

---

## Test A — Authorized callback domain — OPEN

Console-only; the Chrome extension refuses to load `work.weixin.qq.com`
("This site is not allowed due to safety restrictions"), so it could not be driven
by the agent and is checklisted to the user.

**Domain to test: `taihue.com`.** DNS state measured 2026-08-12:

- Nameservers: `bethany.ns.cloudflare.com`, `ezra.ns.cloudflare.com` — **the domain is
  registered and under the user's Cloudflare control.**
- **No A records** on `taihue.com`, `www.taihue.com` or `tender.taihue.com`. Nothing
  is hosted; `curl` cannot resolve it.

This shape is fine for the test. The filing-entity gate fires *before* any
domain-ownership check (ticket 06 §8 saw both as separate panels), so a non-resolving
host still discriminates the three outcomes. And because the domain is on Cloudflare,
outcome 2 is genuinely completable later — serving a `WW_verify_*.txt` is a DNS record
and a static file away, unlike an ICP filing which is unobtainable.

Outcomes, per the ticket:

1. Accepted outright → QR login viable.
2. `WW_verify_*.txt` ownership file required, **no** filing-entity language → passable.
3. Same filing-entity (备案主体) rejection as **Trusted domain name** → **QR login is dead.**

**Capture the whole panel, not the red line.** Ticket 06's post-mortem: the error line
read "Domain name ownership verification failed", which sounds like outcome 2, while
the sentence beneath it demanded a matching filing entity — outcome 3. Transcribing
the red line alone inverted the conclusion.

---

## Test C — can Trusted enterprise IP be unlocked at all? — OPEN

**Promoted from conditional to required by Test B's failure.** The ticket made this
contingent on B returning 60020. It did.

The console gates Trusted enterprise IP behind **Trusted domain name** *or*
**Receive messages server URL**. The first is ICP-blocked (ticket 06 §8), so the
second is the only route. Two things to observe:

1. Does setting **Receive messages server URL** make IP whitelisting available at all?
2. Is an arbitrary IPv4 accepted, or rejected as a third-party-provider address?

**This is larger than QR login.** If the door does not open, then *no* WeCom business
API is reachable from this org at any price — which would retire private
`message/send` reminders permanently and leave the group robot as the only WeCom
integration that can ever work. That reaches ticket 11 (v1 scope) and `buildspec_2`,
not just ADR-0006.

Note that fully *setting* a Receive messages server URL requires a live endpoint that
echoes WeCom's verification challenge, which does not exist yet. Establishing whether
the door opens may be possible without one; standing up such an endpoint is a
separate decision and was not taken unilaterally.

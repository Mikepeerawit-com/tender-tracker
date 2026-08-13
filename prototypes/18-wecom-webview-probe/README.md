# Ticket 18 (#19) — WeCom in-app webview probe

Throwaway. Answers L1–L6 of ticket 18 and then gets deleted along with its Supabase
bucket. It is not app code and nothing in it should survive into `buildspec_2`.

**Live at <https://wecom-webview-probe.vercel.app>** (Vercel prod, project
`wecom-webview-probe`; storage in Supabase project `tender-tracker`,
`jelbliafsgpcyfqfbqjv`, bucket `wecom-probe`).

## Why it is a serverless function and not a static page

Two of the six rows need a server:

- **L3b** wants a cookie the *server* set. It is `HttpOnly`, so JS cannot read it — the
  value on screen is the one the browser sent *back*, which proves the round trip rather
  than proving a string sat on disk. That is the row that matters, because
  [research §3.2](../../docs/research/17-wecom-webview.md) says WebKit sweeps
  script-writable storage after seven idle days and a cookie is the way out.
- **L6** needs `createSignedUploadUrl()` called with the service key. §5.2: the *other*
  thing Supabase calls a signed upload URL (S3-protocol presign) has CORS that cannot be
  configured, so which call mints the URL decides whether a browser can reach it at all.
  The browser PUTs to whatever absolute URL `/api/sign` returns and never assembles one.

The page is on `*.vercel.app` and storage is on `*.supabase.co` **on purpose** — same
origin would make L6's preflight vanish and the result would not transfer to production.

## Already verified, so the phone is only asked the undocumented things

Run from this machine before the link went out:

| Check | Result |
|---|---|
| Supabase CORS preflight from a foreign origin | `200`, `allow-origin: *`, `allow-methods` includes `PUT`, `allow-headers: content-type,x-upsert` |
| Whole L6 chain in desktop Chrome 151 | 4032×2268 → 1600×900, 171 KB, 382 distinct colours, `PUT` **200** in 528 ms, real image rendered |
| L3/L3b across a reload | both flip to `PERSISTED`, original timestamps intact |

So a red L6 on the phone is **WeCom or WebKit**, not Supabase and not the code.

## Local run

```sh
npm install
vercel dev          # needs SUPABASE_URL + SUPABASE_SERVICE_KEY
```

## Teardown

```sh
vercel project rm wecom-webview-probe
# then delete the wecom-probe bucket; keep the tender-tracker project, v1 needs it
```

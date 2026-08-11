# Project spec: Tender Tracker (Platform MVP)

## What this is

A web app for tracking client tenders/RFQs at a manufacturing/purchasing company (first customer: Taihue International Medical Co., Ltd., Thailand). Built as the first module of a future multi-tool internal-tools platform, sold by an independent vendor to client companies. Taihue is the free early-access design partner.

## Stack

- Next.js (React) — deployed on Vercel
- Supabase — Postgres database, auth, file storage (for quote photos)
- Tailwind CSS + shadcn/ui — component styling
- next-intl — i18n (English + Simplified Chinese)

## Data model

**orgs**

- id, name, created_at
  (Taihue is the first row; every other table scopes to org_id for future multi-tenant use)

**users**

- id, org_id, name, email, role (admin/member), created_at

**tenders**

- id, org_id, client_name, tender_name, product(s), date_received, submission_deadline
- status: enum `new | sourcing | quoted | won | lost | cancelled`
- owner_user_id, notes, created_at, updated_at

**quotes** (multiple per tender)

- id, tender_id, supplier_name, country
- quoted_price, currency, lead_time, date_quoted
- match_type: enum `exact | alternative`
- alternative_product_name (nullable, only used when match_type = alternative)
- detail_notes (text)
- is_selected (boolean — which quote was chosen)
- cost_price, selling_price (nullable until selected/finalized; margin = selling - cost, computed in app, not stored)
- created_at

**quote_images**

- id, quote_id, storage_url (Supabase Storage), uploaded_at

## Auth

- Base: Supabase auth (email/password) — works for any future client org regardless of what tools they use internally
- **WeCom login (for Taihue)** — implemented as a custom OAuth 2.0 provider, since Supabase has no built-in WeCom connector:
  1. Register a self-built app in Taihue's WeCom admin console → get Corp ID, Secret, Agent ID
  2. Set trusted domain (可信域名) to the app's deployed domain (Vercel) and configure the OAuth redirect URI
  3. Login flow: redirect to WeCom's authorize URL → user approves in WeCom client → redirected back with a `code` → server exchanges `code` for access token + user info via WeCom API → look up/create matching row in `users` table → issue app session
  4. WeCom login doubles as org membership check — being in Taihue's WeCom implies being a Taihue user
- Note for future clients: WeCom login is per-org (each client with WeCom needs their own self-built app/Corp ID) — treat it as an optional login method alongside email/password, not a universal one, since not every future client will use WeCom

## Email (internal, not part of the app itself)

- Considered: Zoho Mail (free tier) vs Tencent Exmail (paid, ~100 CNY/account/year for custom domain)
- Exmail integrates natively with WeCom (in-WeCom notifications, one-click forward to WeCom groups) — worth the small cost given WeCom is already the login/notification backbone; Zoho remains the zero-cost fallback if budget is tight
- Not yet finalized — decide before onboarding more Taihue colleagues

## Screens (MVP, in build order)

1. **Login** — Supabase auth (email/password) + WeCom OAuth login option; single org (Taihue) hardcoded initially
2. **Tender list / dashboard** — table of tenders: client, product, deadline, status badge, owner, margin. Metric cards: active tenders, due this week, won this month, total quoted value. Search + status filter.
3. **Add/edit tender** — basic form for the fields above
4. **Add quote form** — per tender: supplier, country, price, currency, lead time, match type toggle (exact/alternative — reveals alt product name field when alternative), detail notes, photo upload (multiple images)
5. **Tender detail / quote comparison view** — side-by-side supplier quotes per tender, cheapest highlighted, mark one as selected, enter cost/selling price once selected

## Key behavior notes

- Photos are attached per-quote (not per-tender) since different suppliers may quote different actual products
- "Alternative product" quotes need their own name/model field, not just buried in notes — comparison view should show "Requested: X" vs "Quoted: Y" clearly
- Margin is calculated (selling − cost), never manually entered
- Cost/selling price and margin are internal-only — never expose in anything client-facing (this is not a client-facing app in v1, but keep the field access pattern in mind for later)
- Currency varies by supplier (quotes can come from different countries) — store the original currency per quote, don't force conversion at entry time

## i18n

- All UI strings go through next-intl key lookups from day one — no hardcoded strings in components
- Prioritize translating: status labels, field names, error messages, button labels (the daily-use surface for Chinese-speaking colleagues)
- Tender/quote content itself (free text entered by users) stays in whatever language the user typed — not translated

## Notifications (deadline reminders)

**Channels**

- In-app notification bell — baseline, always on, no external dependency
- WeChat — colleagues primarily use WeChat, but personal WeChat has no public API for sending messages from an app. Use **企业微信 (WeCom / Work WeChat) group robot webhook**: create a WeCom group with the team, generate a webhook URL, app POSTs alert messages into that group. Free, no verified WeCom org required.
  - Future option if 1:1 messages are needed: WeCom "internal app" with template messages — requires a verified WeCom organization, more setup than the group webhook.

**Reminder timing**

- Configurable per tender, not fixed — user can select which day-offsets to be reminded on (e.g. 7 days before, 3 days before, 1 day before — any combination)
- Store as an array field on the tender (or a separate `reminders` table: tender_id, days_before, sent boolean)

**reminders** (new table)

- id, tender_id, days_before (int), sent (boolean, default false), sent_at (nullable)

**Trigger mechanism**

- Vercel Cron (or Supabase Edge Function on a schedule) running daily
- Job: find tenders where `submission_deadline - today = days_before` for any unsent reminder row → create in-app notification + POST to WeCom webhook → mark `sent = true`

## Explicitly out of scope for MVP

- Multi-org / multi-tenant signup flow (single hardcoded org: Taihue)
- Billing
- App hub/launcher (single-tool for now, add once tool #2 exists)
- Admin UI for managing org members (manual via Supabase dashboard for now)

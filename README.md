# Tender Tracker

Tracks client tenders at a medical-supplies trading company: what a client asked for,
what suppliers quoted in response, what we bid back, and whether we won.

- **What it is for and what it must do:** [`buildspec_2.md`](buildspec_2.md)
- **The words the code uses:** [`CONTEXT.md`](CONTEXT.md)
- **Decisions that must not be reversed by accident:** [`docs/adr/`](docs/adr)

## Stack

Next.js (App Router) · Tailwind CSS · shadcn/ui · next-intl (`en` / `zh-Hans`) ·
Supabase (Postgres, Auth, Storage) · Vercel.

## Running it

Requires Node 24+, Docker (for the local Supabase stack) and the
[Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
npm run db:start          # supabase start — brings up local Postgres and applies migrations
cp .env.example .env.local # fill from `supabase status -o env`
npm run dev
```

| Script              | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Development server                                        |
| `npm run build`     | Production build                                          |
| `npm test`          | The test suite — needs the local Supabase stack running   |
| `npm run typecheck` | `next typegen && tsc --noEmit`                            |
| `npm run lint`      | ESLint                                                    |
| `npm run db:start`  | Start local Supabase                                      |
| `npm run db:reset`  | Rebuild the local database from `supabase/migrations/`     |

## Testing

**There is one seam: route handlers and server actions, over a real local Postgres.**
Tests bring nothing up themselves — run `supabase start` first, and they read the
stack's URL and keys from `supabase status`. Only two outbound boundaries are ever
stubbed: the WeCom robot webhook and the Frankfurter rate fetch.

The seam is chosen deliberately. Progress, the three overdue conditions and the list
blocks are *queries*; testing an extracted pure function tests something that is not
what ships. See "Testing Decisions" in `buildspec_2.md`.

## Conventions

- **No hardcoded user-facing strings.** Every string is a next-intl key, in both
  `src/messages/en.json` and `src/messages/zh-Hans.json`, from the first component
  onward. The locale is resolved server-side and is not in the URL — [ADR-0011](docs/adr/0011-locale-is-not-in-the-url.md).
- **The run instant is injected at the request boundary, never read inside business
  logic** — [ADR-0010](docs/adr/0010-injected-run-instant.md). `new Date()` and
  `Date.now()` are ESLint errors everywhere except `src/lib/run-instant.ts`.

## Deploying

Vercel, with Supabase in Singapore (`ap-southeast-1`). Two steps need a human with
account access:

1. Import the repo into Vercel and set the environment variables from
   `.env.example` against the hosted Supabase project.
2. Point the custom domain at the Vercel deployment.

`GET /api/health` returns `{"status":"ok","database":"reachable"}` when the deployment
can reach Postgres — that is the check to run against the domain once it resolves.

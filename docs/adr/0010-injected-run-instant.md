# The run instant is injected at the request boundary, never read inside business logic

Ticket 21 ([#21](https://github.com/Mikepeerawit-com/tender-tracker/issues/21)) establishes this before any domain code exists, because it is the one convention in the build that cannot be retrofitted cheaply: by the time the reminder engine is written, a `new Date()` will be sitting inside every rule that needs testing.

**The wall clock is read once, at the request boundary, and passed down as an argument.** `runInstantFrom(request)` in `src/lib/run-instant.ts` is the only place in the app allowed to construct a zero-argument `Date`. Everything below it — Progress, the three overdue conditions, the reminder engine, the Digest — takes the instant as a parameter.

## Why this and not a mockable clock module

Most of what v1 gets wrong, it gets wrong at a date boundary. The reminder rules are all of the form *"a run that is missed and then happens two days later still sends, but does not nudge for a milestone that has since passed"*; the overdue conditions are all *"the deadline has passed and this other thing has not happened"*. None of those can be stated as a test unless the test chooses the instant.

A globally stubbed clock (`vi.setSystemTime`, or a module-level `clock` singleton) would also make them stateable, and was rejected for two reasons. It makes the instant invisible at the call site, so a reader of the reminder engine cannot see that its behaviour is time-dependent — which is the single most important thing about it. And it does not survive the seam this project actually uses: tests call route handlers over a real local Postgres, and Postgres has its own clock that no test stub reaches. Passing the instant explicitly keeps one instant per run, chosen by the caller, and visible in the signature.

**The org timezone comes from the `orgs` row, not the server.** The instant is a point in time; the day it falls on is a question only the org's timezone can answer. A handler that reads `process.env.TZ` or the server's locale is wrong in the same way a handler that reads the wall clock is wrong — it works on the developer's laptop and drifts in production.

## How it is enforced

- `runInstantFrom(request)` resolves the instant, and is the documented entry point for handlers, server actions and the daily cron.
- ESLint bans bare `new Date()` and `Date.now()` everywhere under `src/` except `src/lib/run-instant.ts`. The convention is a lint error, not a code-review habit — a rule nobody can forget is worth more than a rule everybody agrees with.
- Tests pin the instant with the `x-run-instant` header. It is honoured only when `ALLOW_RUN_INSTANT_HEADER=true` **and** the build is not production. A header is untrusted input: in production it is disregarded silently, so traffic can never steer the app's idea of time. An honoured header that cannot be parsed is a 400 rather than a fallback to "now", because a pinned instant that quietly becomes the wall clock makes a test pass by lying.

## Consequences

- **Every handler signature that depends on time says so.** `new Date()` appearing in a diff outside the boundary module is a lint failure and a design signal.
- **The cron entry point takes its instant from the request.** Vercel Cron calls a route; the route resolves the instant and hands it to the engine. There is no separate "what time is it" path for scheduled work.
- **Date-boundary tests need no clock stubbing at all** — they construct a request. That is the same mechanism production uses, so a passing test exercises the shipped code path.

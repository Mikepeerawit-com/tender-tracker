# The Group Robot's webhook is org data, not deployment config

Ticket [#38](https://github.com/Mikepeerawit-com/tender-tracker/issues/38). **Supersedes the env-var bullets of [ADR-0012](0012-what-the-group-robot-may-say.md)** and the first acceptance criterion of [#32](https://github.com/Mikepeerawit-com/tender-tracker/issues/32) — *"the URL read from an environment variable"*. Everything else 0012 decided — financial silence, hardcoded Simplified Chinese, `text`-only, the injected boundary — stands unchanged.

#32 shipped the webhook as `WECOM_ROBOT_WEBHOOK`, which is what `buildspec_2` assumed. That was wrong in two ways, and both were only visible once the seam existed.

**It is the wrong owner.** The app models `orgs`, and a Group Robot belongs to one of them. An environment variable is implicitly single-tenant — it says the robot is a property of the deployment, which is a claim the domain model contradicts.

**It puts a non-engineer's change behind a redeploy.** The change most likely to be needed is repointing the robot after somebody recreates the WeCom group, and the person who notices is the Org Admin, not whoever holds the Vercel login. A credential that cannot be rotated by the person responsible for it is a credential that does not get rotated.

## Decisions

- **The webhook lives in `group_robots`**, one row per org, and `WECOM_ROBOT_WEBHOOK` is gone from the code, `.env.example` and the README. One source of truth, so "which group did that go to" has one place to look.
- **`sendGroupMessages` takes the webhook as its first argument.** It reaches for nothing.
- **An Org Admin sets it at `/settings/group-robot`.** Gated in the server action, not by hiding the form.
- **A pasted value is normalised and validated at write time** — trimmed, `https`, WeCom's host, non-empty `key` — and refused otherwise.
- **An org with no robot is reported as unconfigured, never as a send failure.**

## Why it gets its own table

`orgs` already has a policy, and it is the right one for everything else on that row:

```sql
create policy org_members_full_access on orgs
  for all to authenticated
  using (id = public.current_org_id())
```

`for all`, to every member. That matches the project's deliberate stance that inside an org everyone sees everything, cost and margin included ([ADR-0004](0004-assignees-compete-not-divide.md), and the RLS tests say so outright). A webhook column there would inherit it.

**The webhook is not business data. It is a bearer credential** — a URL that lets whoever holds it post to the company's WeCom group *as this app*, with no token, no login and no audit. Under that policy every member could read it out through the anon key, and — worse — write it. Repointing it is the dangerous move: it is silent, every send afterwards still returns `errcode 0`, and the org's entire tender traffic starts arriving somewhere nobody is watching. That is the same silent-failure class this project has fought at every turn, with a much larger blast radius.

So it sits in a table with **RLS enabled and no policy at all**, plus `revoke all ... from anon, authenticated`. Two locks rather than one: the revoke makes a read a permission error rather than an empty set, and it survives somebody later adding a policy here by pattern-matching on the neighbouring tables. The service role bypasses both, and the send path already runs there.

## Consequences

- **The stored URL is never returned to a page.** The screen asks `groupRobotStatus`, whose return type cannot carry it — configured, and when it last changed. This is enforced by the shape of the function the page can reach, not by remembering not to render a field.
- **`updated_by` is recorded.** The one audit question worth being able to answer about a value that redirects every notification the org sends.
- **Validation happens while a human is standing at the form.** [Ticket 06](../../.scratch/tender-tracker-mvp/research/06-wecom-console.md) lost an entire measurement session to a webhook pasted with a stray newline, which failed every send with `URL rejected: Malformed input`. Pasting from a chat client is the only way this value ever arrives, so whitespace is expected input. The host check catches the rest — a Slack hook or a shortened link would be stored happily and then fail at 08:00 every morning, on the one path nobody watches precisely because it is meant to run unattended.
- **A fresh deployment notifies nobody until an Org Admin sets it up, and says so on the screen.** That is the intended trade for deleting the env var: unconfigured is visible, where a missing environment variable was not.
- **The daily cron resolves the webhook per org** via `webhookFor(orgId)`, which takes an org id rather than a session — the cron has none. #33 inherits this.

-- The Group Robot's webhook moves from deployment config into the org's own data, so an
-- Org Admin can set it in the app instead of an engineer setting it on the deployment.
-- Supersedes the env-var bullets of ADR-0012. See docs/adr/0013-group-robot-webhook-is-org-data.md.
--
-- It gets its own table rather than a column on `orgs` because of what `orgs`'s policy
-- says: `for all to authenticated`, matching on the caller's own org. That is right for
-- everything else on the row — inside an org everyone sees everything — and wrong for
-- this one value, because the webhook is a *bearer credential*. Anyone holding it can
-- post to the company WeCom group as the app. On that policy every member could read it
-- out through the anon key, or silently repoint the org's notifications at a group of
-- their own choosing.
create table group_robots (
  -- `cascade` rather than the schema's usual `restrict`: this row is configuration
  -- belonging to the org, not a business record anybody could need to read back. An org
  -- that is gone has no notifications to send.
  org_id      uuid primary key references orgs(id) on delete cascade,
  webhook_url text        not null,
  updated_at  timestamptz not null default now(),
  -- `set null` rather than `restrict`: a colleague leaving must not pin a row that the
  -- whole notification path reads.
  updated_by  uuid        references users(id) on delete set null
);

comment on table group_robots is
  'One WeCom Group Robot per org. Deliberately unreachable through the anon key: the webhook is a bearer credential, and the only reader is the send path running on the service role.';
comment on column group_robots.webhook_url is
  'Bearer credential — anyone holding it can post to the org''s WeCom group as the app. Never rendered back to the browser; the admin screen shows configured/not-configured only. Validated at write time (https, WeCom''s host): #06 lost a measurement session to a URL pasted with a stray newline.';
comment on column group_robots.updated_by is
  'Who last changed it. The one audit question worth being able to answer about a credential that redirects every notification the org sends.';

-- Two locks, deliberately. RLS with no policy makes a read return nothing; the revoke
-- makes it a permission error, and survives somebody later adding a policy here by
-- pattern-matching on the other tables. The service role bypasses both, which is the
-- only path that legitimately reads this.
alter table group_robots enable row level security;
revoke all on table public.group_robots from anon, authenticated;

-- Replacing a webhook has to move `updated_at`, and the default only covers the insert.
-- The database owns this timestamp rather than the app: it records when a row changed,
-- which is a fact about the row, not one of the org-timezone date boundaries ADR-0010
-- makes the caller choose.
create trigger group_robots_touch_updated_at
  before update on group_robots
  for each row execute function public.touch_updated_at();

-- Every Reminder arrives by email, and the Group Robot becomes an extra (ADR-0034).
--
-- With two transports, `reminders.sent` alone cannot say what happened: flipping it
-- when email succeeded and the robot failed loses the group post, and not flipping it
-- re-sends the email tomorrow to somebody who already read it. So one row here records
-- one Reminder's success on one channel, and `sent` keeps its meaning of "nothing
-- further is owed on this row" — set only once every channel the org actually has has
-- succeeded. The `reminders_due` partial index and the `due_date <=` catch-up query
-- are untouched, so ADR-0005 and ADR-0015 semantics survive intact.
create table reminder_deliveries (
  reminder_id   uuid not null references reminders(id) on delete cascade,
  channel       text not null check (channel in ('email', 'wecom')),
  org_id        uuid not null references orgs(id),
  -- No default. The instant is the run's, passed in from the request boundary
  -- (ADR-0010), never read from the database's own clock.
  delivered_at  timestamptz not null,
  primary key (reminder_id, channel)
);

comment on table reminder_deliveries is
  'One Reminder''s completion on one channel (ADR-0034): a success — or, on email only, a rejection that would repeat identically every morning, which closes the delivery rather than queueing a retry that cannot succeed. It is what stops a transport that already finished from sending again when the other one is retried. An org with no Group Robot is complete on email alone; reminders.sent still means "nothing further is owed" and is set only once every channel the org has is done.';

-- Members may see what their own org's runs delivered; only the cron writes, and the
-- cron holds the service role, which RLS does not bind. The same one-policy org-boundary
-- shape as every other org_id-carrying table.
alter table reminder_deliveries enable row level security;

create policy org_members_read on reminder_deliveries
  for select to authenticated
  using (org_id = public.current_org_id());

-- 20260825010000 is explicit that future tables inherit nothing.
grant select on table reminder_deliveries to authenticated;
grant select, insert, update, delete on table reminder_deliveries to service_role;

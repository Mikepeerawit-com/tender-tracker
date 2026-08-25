import "server-only";

import { currentUser } from "@/lib/auth/session";
import { isCalendarDate, todayIn } from "@/lib/calendar-date";
import { getOrgSettings } from "@/lib/org/org";
import { rescheduleReminders, scheduleReminders } from "@/lib/reminders/reminders";
import type { Deadlines } from "@/lib/reminders/schedule";
import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";
import { isItemOutcome, type ItemOutcome } from "@/lib/tenders/outcome";
import type { RobotBoundary } from "@/lib/wecom/robot";

import { announceOutcome } from "./outcome-news";

/**
 * Recording a Tender, its Items, and who is working it.
 *
 * Everything here reads and writes through the *session* client, so RLS is what keeps
 * one org out of another's Tenders. The checks in this file are therefore about the
 * rules RLS cannot express — a Tender always has at least one Item, the Internal Quote
 * Deadline comes first, and only the Owner may assign somebody other than themselves.
 * Under ten trusted users there is no editing gate beyond org membership: anyone who
 * can see a Tender may fix a typo in it.
 */

export type TenderItemFields = {
  productName: string;
  description: string | null;
  quantity: number;
  unit: string;
};

export type TenderFields = {
  clientName: string;
  title: string;
  /** All four are `yyyy-mm-dd`: a deadline is a day in the org timezone, not an instant. */
  dateReceived: string;
  internalQuoteDeadline: string;
  clientSubmissionDeadline: string;
  expectedDecisionDate: string | null;
  ownerUserId: string;
  notes: string | null;
};

/**
 * Every way a write here can be refused, as a list rather than a bare union: the
 * wording lives in the message files, and a reason with none renders to the user as its
 * own key. `messages.test.ts` walks this to hold both locales to it.
 */
export const tenderProblems = [
  "forbidden",
  "not_found",
  "unassignable",
  "incomplete",
  "invalid_date",
  "deadlines_out_of_order",
  "no_items",
  "invalid_quantity",
  "last_item",
  "invalid_outcome",
  "failed",
] as const;

export type TenderProblem = (typeof tenderProblems)[number];

export type TenderResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; reason: TenderProblem };

/** A Tender without what hangs off it — everything both reads return. */
export type TenderSummary = TenderFields & {
  id: string;
  reference: string;
  submittedAt: string | null;
  ownerName: string;
};

/**
 * An Item as the list read carries it: enough to derive from, and nothing more.
 *
 * The Outcome rides along for the same reason it does on {@link TenderItem} — Progress
 * and both overdue conditions are readings of *all* of a Tender's Items (ADR-0001), so
 * fetching them per Tender would make the derivation depend on how many round trips the
 * caller made.
 */
export type TenderListItem = { id: string; outcome: ItemOutcome | null };

export type TenderListRow = TenderSummary & { items: TenderListItem[] };

/**
 * An Item as a reader gets it — its fields, and how it ended.
 *
 * The Outcome rides along with the Item rather than being fetched where it is shown,
 * because the Tender-level Outcome is a reading of *all* of them (ADR-0001) and a
 * per-Item read would make the derivation depend on how many round trips a caller made.
 */
export type TenderItem = { id: string } & TenderItemFields & {
    outcome: ItemOutcome | null;
    /** When it was decided. Always set with the Outcome and cleared with it. */
    outcomeAt: string | null;
  };

export type Tender = TenderSummary & {
  items: TenderItem[];
  assignees: { id: string; name: string }[];
};

const tenderColumns =
  "id, reference, client_name, title, date_received, internal_quote_deadline, " +
  "client_submission_deadline, expected_decision_date, submitted_at, notes, owner_user_id";

const itemColumns = "id, product_name, description, quantity, unit, outcome, outcome_at";

/**
 * The database shapes the two read queries come back as, written out rather than
 * inferred. This project has no generated `Database` types, so PostgREST's inference
 * from the select string has nothing to resolve an embed against and reports a to-one
 * join as an array. `overrideTypes` is where the two are reconciled, once, in the only
 * two places that read an embed.
 */
type OwnerEmbed = { name: string } | null;

type TenderItemDbRow = {
  id: string;
  product_name: string;
  description: string | null;
  quantity: number;
  unit: string;
  outcome: ItemOutcome | null;
  outcome_at: string | null;
};

type TenderDbRow = {
  id: string;
  reference: string;
  client_name: string;
  title: string;
  date_received: string;
  internal_quote_deadline: string;
  client_submission_deadline: string;
  expected_decision_date: string | null;
  submitted_at: string | null;
  notes: string | null;
  owner_user_id: string;
  owner: OwnerEmbed;
  items: TenderItemDbRow[];
  assignees: { user: { id: string; name: string } | null }[];
};

type TenderListDbRow = Omit<TenderDbRow, "items" | "assignees"> & {
  items: TenderListItem[];
};

export async function createTender(
  input: TenderFields & { items: TenderItemFields[] },
  store: SessionCookieStore,
): Promise<TenderResult<{ tenderId: string; reference: string }>> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const problem =
    (await assignableProblem(input.ownerUserId, supabase)) ??
    fieldProblem(input) ??
    itemsProblem(input.items);

  if (problem) return { ok: false, reason: problem };

  // `reference` is deliberately absent from the payload: a trigger issues it from the
  // org's counter, and anything sent here would be overwritten anyway.
  const { data, error } = await supabase
    .from("tenders")
    .insert({ org_id: caller.orgId, ...tenderRow(input) })
    .select("id, reference")
    .single();

  if (error !== null || !data) return { ok: false, reason: "failed" };

  const { error: itemsError } = await supabase
    .from("tender_items")
    .insert(
      input.items.map((item, index) => itemRow(item, caller.orgId, data.id, index)),
    );

  if (itemsError) {
    // PostgREST has no transaction across the two inserts, and a Tender with no Items
    // is a shape the rest of the app is entitled to assume cannot exist.
    await supabase.from("tenders").delete().eq("id", data.id);

    return { ok: false, reason: "failed" };
  }

  // A Tender nobody will be reminded about is the failure this product exists to
  // prevent, and it is indistinguishable from a healthy one until the morning it is
  // too late — so it is rolled back here exactly like a Tender with no Items.
  const scheduled = await scheduleReminders(
    {
      tenderId: data.id,
      orgId: caller.orgId,
      deadlines: deadlinesOf(input),
    },
    supabase,
  );

  if (!scheduled) {
    await supabase.from("tenders").delete().eq("id", data.id);

    return { ok: false, reason: "failed" };
  }

  return { ok: true, tenderId: data.id, reference: data.reference };
}

/**
 * Edit a Tender — and, when a deadline moves, re-date every reminder counted back from it.
 *
 * The instant is a parameter because the reschedule needs to know what day it is in the
 * org's timezone to decide whether a nudge already marked sent has become one that has
 * not happened yet (ADR-0005 rule 3, ADR-0010). A deadline pushed back that left its
 * reminders marked done takes a Tender quiet at exactly the point it has the most runway.
 */
export async function updateTender(
  { tenderId, ...input }: TenderFields & { tenderId: string },
  at: Date,
  store: SessionCookieStore,
): Promise<TenderResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);

  // RLS turns "another org's Tender" into no row, which is the same answer as a Tender
  // deleted while the form was open.
  const { data: existing } = await supabase
    .from("tenders")
    .select("owner_user_id")
    .eq("id", tenderId)
    .maybeSingle();

  if (!existing) return { ok: false, reason: "not_found" };

  const problem =
    // Only a *change* of Owner is an assignment. Somebody leaving is exactly when their
    // Tenders get edited, and if an untouched Owner had to pass the disabled check, the
    // dates on their Tenders could not be fixed without reassigning them first.
    (existing.owner_user_id === input.ownerUserId
      ? null
      : await assignableProblem(input.ownerUserId, supabase)) ?? fieldProblem(input);

  if (problem) return { ok: false, reason: problem };

  const { data, error } = await supabase
    .from("tenders")
    .update(tenderRow(input))
    .eq("id", tenderId)
    .select("id, org_id");

  if (error !== null) return { ok: false, reason: "failed" };

  // Still checked after the write: the read above and this update are two statements,
  // and the Tender can go between them.
  if (data.length !== 1) return { ok: false, reason: "not_found" };

  const { timezone } = await getOrgSettings(store);
  // Unconditional rather than only when a deadline changed: the reconcile is idempotent,
  // and a comparison against the old row is one more thing to get wrong on the one path
  // whose failure is silent by construction.
  const rescheduled = await rescheduleReminders(
    { tenderId, orgId: data[0].org_id, deadlines: deadlinesOf(input) },
    todayIn(timezone, at),
    supabase,
  );

  // Reported rather than swallowed, even though the edit itself has already been written.
  // Saying "saved" here would leave the Tender quieter than its dates say, with nothing
  // on any screen contradicting it — the silent failure ADR-0005 exists to remove. The
  // reconcile states the whole schedule rather than a diff, so the retry this sends the
  // user back for is safe and lands them in the right place.
  return rescheduled ? { ok: true } : { ok: false, reason: "failed" };
}

export async function addTenderItem(
  { tenderId, ...item }: TenderItemFields & { tenderId: string },
  store: SessionCookieStore,
): Promise<TenderResult<{ itemId: string }>> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const problem = itemProblem(item);

  if (problem) return { ok: false, reason: problem };

  const supabase = createSessionClient(store);
  const { data: tender } = await supabase
    .from("tenders")
    .select("id")
    .eq("id", tenderId)
    .maybeSingle();

  if (!tender) return { ok: false, reason: "not_found" };

  // An Item added later belongs at the end of the list, not wherever the heap puts it.
  // Two adds racing can read the same last place; readers break the tie on `id`, so the
  // worst case is two Items whose order between themselves is arbitrary but stable —
  // not a list that reshuffles on every read.
  const { data: last } = await supabase
    .from("tender_items")
    .select("ordinal")
    .eq("tender_id", tenderId)
    .order("ordinal", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("tender_items")
    .insert(itemRow(item, caller.orgId, tenderId, (last?.ordinal ?? -1) + 1))
    .select("id")
    .single();

  if (error !== null || !data) return { ok: false, reason: "failed" };

  return { ok: true, itemId: data.id };
}

export async function updateTenderItem(
  { itemId, ...item }: TenderItemFields & { itemId: string },
  store: SessionCookieStore,
): Promise<TenderResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const problem = itemProblem(item);

  if (problem) return { ok: false, reason: problem };

  const { data, error } = await createSessionClient(store)
    .from("tender_items")
    .update(itemFields(item))
    .eq("id", itemId)
    .select("id");

  if (error !== null) return { ok: false, reason: "failed" };

  return data.length === 1 ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * Remove an Item, unless it is the only one left. A Tender asks for at least one
 * product by definition, so emptying it is a delete of the Tender wearing a disguise.
 */
export async function removeTenderItem(
  itemId: string,
  store: SessionCookieStore,
): Promise<TenderResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);

  const { data: item } = await supabase
    .from("tender_items")
    .select("id, tender_id")
    .eq("id", itemId)
    .maybeSingle();

  if (!item) return { ok: false, reason: "not_found" };

  const { data: siblings } = await supabase
    .from("tender_items")
    .select("id")
    .eq("tender_id", item.tender_id);

  if ((siblings ?? []).length <= 1) return { ok: false, reason: "last_item" };

  const { error } = await supabase.from("tender_items").delete().eq("id", itemId);

  return error === null ? { ok: true } : { ok: false, reason: "failed" };
}

/**
 * Record that the Bid went out — or take that back.
 *
 * `submitted_at` is a **fact, not a plan**, and it is the only thing that distinguishes
 * "submitted on time" from "never submitted" once the Client Submission Deadline has
 * passed (ADR-0003). No column says a submission was missed; its absence is what says so,
 * which is why the undo exists: a submission recorded in error hides the one failure this
 * product is for, and nothing else in the data would contradict it.
 *
 * The instant is passed in rather than read here — the clock belongs to the request
 * boundary (ADR-0010), so a test can record a Bid as having gone out last Tuesday.
 *
 * The Owner is accountable for the Bid going out on time, and is who the reminders reach.
 * Recording that it *did* go out is not gated on them all the same: under ten trusted
 * users anyone who can see a Tender may write to it, and the colleague who pressed send
 * while the Owner was on a plane must be able to say so.
 */
export async function recordSubmission(
  { tenderId, submittedAt }: { tenderId: string; submittedAt: Date | null },
  store: SessionCookieStore,
): Promise<TenderResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const { data, error } = await createSessionClient(store)
    .from("tenders")
    .update({ submitted_at: submittedAt === null ? null : submittedAt.toISOString() })
    .eq("id", tenderId)
    .select("id");

  if (error !== null) return { ok: false, reason: "failed" };

  // Another org's Tender and a deleted one are the same answer through RLS, and the same
  // answer is the right one to give.
  return data.length === 1 ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * Record how one Tender Item ended — or take the decision back off it.
 *
 * **Per Item, because a client awarding half a Tender to us and half to a competitor is
 * ordinary** (ADR-0001). What the Tender as a whole came to is derived from these by
 * `tenderOutcome`, and is stored nowhere.
 *
 * **`partial` is refused here.** It is a Tender-level display state that no row may hold,
 * and the `outcome` CHECK would refuse it too — but a refusal from the database arrives
 * as a failed save with nothing to say, and this one arrives as a sentence. Anything
 * outside the four stored values is refused the same way.
 *
 * `outcome_at` moves with the Outcome and is cleared with it, which the `outcome_dated`
 * CHECK requires and which metrics like "won this month" depend on: `updated_at` is not a
 * decision date. The instant comes from the request boundary (ADR-0010).
 */
export async function setItemOutcome(
  {
    itemId,
    outcome,
    decidedAt,
  }: {
    itemId: string;
    /**
     * As posted. A `string` rather than an `ItemOutcome`, because what arrives from a
     * form has not earned the narrower type — and a signature that claimed it had would
     * make `invalid_outcome` a refusal of something the caller had already promised
     * could not happen.
     */
    outcome: string | null;
    /** Ignored when the Outcome is being taken back off: there is no decision to date. */
    decidedAt: Date;
  },
  store: SessionCookieStore,
  /** The group robot, injected so a test can stand at it (ADR-0012). */
  robot: RobotBoundary = {},
): Promise<TenderResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  if (outcome !== null && !isItemOutcome(outcome)) {
    return { ok: false, reason: "invalid_outcome" };
  }

  const supabase = createSessionClient(store);
  const { data: item } = await supabase
    .from("tender_items")
    .select("outcome")
    .eq("id", itemId)
    .maybeSingle();

  // Another org's Item and a deleted one are the same answer through RLS, and the same
  // answer is the right one to give.
  if (!item) return { ok: false, reason: "not_found" };

  // Recording the Outcome an Item already has is not a decision, and must not re-date the
  // one that was really taken. `outcome_at` is what "won this month" is counted on, so a
  // save that changed nothing would quietly move a January win into August.
  if (item.outcome === outcome) return { ok: true };

  const { data, error } = await supabase
    .from("tender_items")
    .update({
      outcome,
      outcome_at: outcome === null ? null : decidedAt.toISOString(),
    })
    .eq("id", itemId)
    .select("id");

  if (error !== null) return { ok: false, reason: "failed" };

  // Still checked after the write: the read above and this update are two statements, and
  // the Item can go between them.
  if (data.length !== 1) return { ok: false, reason: "not_found" };

  // Only `won` and `lost` are news, and only once: the equality check above has already
  // turned re-recording the same Outcome into a no-op, so this cannot post twice for one
  // decision. The announcement is best effort and never fails the write — see
  // `./outcome-news.ts` for why that is the opposite call from the reminder schedule.
  if (outcome === "won" || outcome === "lost") {
    await announceOutcome({ itemId, outcome }, robot);
  }

  return { ok: true };
}

/**
 * Assignees compete rather than divide (ADR-0004), so adding yourself is not a request
 * anyone has to approve — it is how you enrol in the Tender's reminders before you
 * start ringing suppliers. Adding or removing *somebody else* is the Owner's call.
 */
export async function addAssignee(
  { tenderId, userId }: { tenderId: string; userId: string },
  store: SessionCookieStore,
): Promise<TenderResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const problem =
    (await standingProblem({ tenderId, userId }, caller.id, supabase)) ??
    // Only on the way in. Taking a Disabled colleague *off* a Tender has to keep
    // working — that is exactly when somebody wants to.
    (await assignableProblem(userId, supabase));

  if (problem) return { ok: false, reason: problem };

  const { error } = await supabase
    .from("tender_assignees")
    // Idempotent on purpose: two people pressing "add me" is not a conflict to report.
    .upsert(
      { tender_id: tenderId, user_id: userId, org_id: caller.orgId },
      { onConflict: "tender_id,user_id", ignoreDuplicates: true },
    );

  return error === null ? { ok: true } : { ok: false, reason: "failed" };
}

export async function removeAssignee(
  { tenderId, userId }: { tenderId: string; userId: string },
  store: SessionCookieStore,
): Promise<TenderResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const problem = await standingProblem({ tenderId, userId }, caller.id, supabase);

  if (problem) return { ok: false, reason: problem };

  const { error } = await supabase
    .from("tender_assignees")
    .delete()
    .eq("tender_id", tenderId)
    .eq("user_id", userId);

  return error === null ? { ok: true } : { ok: false, reason: "failed" };
}

/**
 * Every Tender the caller's org has, soonest Client Submission Deadline first.
 *
 * A plain list, and deliberately so: the worklist blocks that decide what a Tender is
 * *doing* need the Quotes and the No Supplier Found records they are derived from, which
 * are two more reads. `@/lib/tenders/worklist` is where that assembly lives, over this.
 */
export async function listTenders(store: SessionCookieStore): Promise<TenderListRow[]> {
  const { data } = await createSessionClient(store)
    .from("tenders")
    .select(
      `${tenderColumns}, owner:users!tenders_owner_user_id_fkey(name), ` +
        `items:tender_items(id, outcome)`,
    )
    .order("client_submission_deadline")
    .overrideTypes<TenderListDbRow[], { merge: false }>();

  return (data ?? []).map((row) => ({ ...tenderSummary(row), items: row.items }));
}

/** One Tender with its Items and Assignees, or null if the caller cannot see it. */
export async function getTender(
  tenderId: string,
  store: SessionCookieStore,
): Promise<Tender | null> {
  const { data } = await createSessionClient(store)
    .from("tenders")
    .select(
      `${tenderColumns}, owner:users!tenders_owner_user_id_fkey(name), ` +
        `items:tender_items(${itemColumns}), assignees:tender_assignees(user:users(id, name))`,
    )
    .eq("id", tenderId)
    // `ordinal` is the order the Items were typed in; `id` only breaks a tie between two
    // that were added concurrently, so the list is never arbitrary twice running.
    .order("ordinal", { referencedTable: "tender_items" })
    .order("id", { referencedTable: "tender_items" })
    .maybeSingle()
    .overrideTypes<TenderDbRow, { merge: false }>();

  if (!data) return null;

  return {
    ...tenderSummary(data),
    items: data.items.map((item) => ({
      id: item.id,
      productName: item.product_name,
      description: item.description,
      // `numeric` crosses the wire as a JSON number, but a wider one than `quantity`
      // will ever hold. Narrowing here keeps the coercion out of every caller.
      quantity: Number(item.quantity),
      unit: item.unit,
      outcome: item.outcome,
      outcomeAt: item.outcome_at,
    })),
    assignees: data.assignees
      .map((row) => row.user)
      .filter((user) => user !== null)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** snake_case off the wire to the camelCase the app speaks, in one place for both reads. */
function tenderSummary(row: Omit<TenderDbRow, "items" | "assignees">): TenderSummary {
  return {
    id: row.id,
    reference: row.reference,
    clientName: row.client_name,
    title: row.title,
    dateReceived: row.date_received,
    internalQuoteDeadline: row.internal_quote_deadline,
    clientSubmissionDeadline: row.client_submission_deadline,
    expectedDecisionDate: row.expected_decision_date,
    submittedAt: row.submitted_at,
    notes: row.notes,
    ownerUserId: row.owner_user_id,
    // An Owner with no name means the embed came back empty, which RLS cannot produce
    // for a Tender the caller can already see.
    ownerName: row.owner?.name ?? "",
  };
}

function tenderRow(input: TenderFields) {
  return {
    client_name: input.clientName.trim(),
    title: input.title.trim(),
    date_received: input.dateReceived,
    internal_quote_deadline: input.internalQuoteDeadline,
    client_submission_deadline: input.clientSubmissionDeadline,
    expected_decision_date: blankToNull(input.expectedDecisionDate),
    owner_user_id: input.ownerUserId,
    notes: blankToNull(input.notes),
  };
}

function itemFields(item: TenderItemFields) {
  return {
    product_name: item.productName.trim(),
    description: blankToNull(item.description),
    quantity: item.quantity,
    unit: item.unit.trim(),
  };
}

function itemRow(
  item: TenderItemFields,
  orgId: string,
  tenderId: string,
  ordinal: number,
) {
  return { org_id: orgId, tender_id: tenderId, ordinal, ...itemFields(item) };
}

/**
 * Has the caller the standing to change who is on this Tender?
 *
 * Adding or removing *yourself* asks nobody: ADR-0004 makes self-assignment the step
 * that enrols you in the Tender's reminders, and its mirror has to exist or "add me"
 * becomes a decision you cannot take back. Doing it to somebody else is the Owner's.
 */
async function standingProblem(
  { tenderId, userId }: { tenderId: string; userId: string },
  callerId: string,
  supabase: ReturnType<typeof createSessionClient>,
): Promise<TenderProblem | null> {
  const { data: tender } = await supabase
    .from("tenders")
    .select("id, owner_user_id")
    .eq("id", tenderId)
    .maybeSingle();

  if (!tender) return "not_found";

  return userId === callerId || tender.owner_user_id === callerId ? null : "forbidden";
}

/**
 * Can this person be given a Tender — as its Owner, or as an Assignee?
 *
 * Asked through the session client on purpose: RLS scopes `users` to the caller's org,
 * so "no such row" and "somebody else's colleague" are the same answer, which is the
 * answer we want to give either way.
 *
 * `disabled_at` has to be checked here and not only in the pickers. A disabled member's
 * row is still visible to their colleagues — RLS hides it from *them*, not from the org —
 * so a posted id would otherwise hand a Tender to somebody who reads nothing and can act
 * on none of it.
 *
 * The refusal is `unassignable`, never `not_found`: what is missing is the *person*, and
 * on /tenders/new there is no Tender to report as gone. The two share a shape and cannot
 * share a sentence.
 */
async function assignableProblem(
  userId: string,
  supabase: ReturnType<typeof createSessionClient>,
): Promise<TenderProblem | null> {
  if (!userId) return "incomplete";

  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .is("disabled_at", null)
    .maybeSingle();

  return data ? null : "unassignable";
}

/**
 * The dates the schedule is built from, with the optional one normalised.
 *
 * An expected decision date that arrives blank is the Owner *not* asking to be chased,
 * and `""` is not that — it is a date the schedule would try to count from. The same
 * `blankToNull` the row write uses, so what is stored and what is scheduled can never
 * disagree about whether the chase is on.
 */
function deadlinesOf(input: TenderFields): Deadlines {
  return {
    internalQuoteDeadline: input.internalQuoteDeadline,
    clientSubmissionDeadline: input.clientSubmissionDeadline,
    expectedDecisionDate: blankToNull(input.expectedDecisionDate),
  };
}

function fieldProblem(input: TenderFields): TenderProblem | null {
  if (!input.clientName.trim() || !input.title.trim()) return "incomplete";

  const dates = [
    input.dateReceived,
    input.internalQuoteDeadline,
    input.clientSubmissionDeadline,
    ...(blankToNull(input.expectedDecisionDate) === null ? [] : [input.expectedDecisionDate!]),
  ];

  if (!dates.every(isCalendarDate)) return "invalid_date";

  // The Internal Quote Deadline exists so the team can pick what to Bid *before* the Bid
  // goes out. Behind the submission deadline it chases nobody, and the Tender reads as
  // healthy right up to the day it is lost.
  if (input.internalQuoteDeadline > input.clientSubmissionDeadline) {
    return "deadlines_out_of_order";
  }

  return null;
}

function itemsProblem(items: TenderItemFields[]): TenderProblem | null {
  if (items.length === 0) return "no_items";

  for (const item of items) {
    const problem = itemProblem(item);

    if (problem) return problem;
  }

  return null;
}

function itemProblem(item: TenderItemFields): TenderProblem | null {
  if (!item.productName.trim() || !item.unit.trim()) return "incomplete";
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) return "invalid_quantity";

  return null;
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
}

import "server-only";

import { currentUser } from "@/lib/auth/session";
import { isCalendarDate } from "@/lib/calendar-date";
import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

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

export type TenderProblem =
  | "forbidden"
  | "not_found"
  | "incomplete"
  | "invalid_date"
  | "deadlines_out_of_order"
  | "no_items"
  | "invalid_quantity"
  | "last_item"
  | "failed";

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

export type TenderListRow = TenderSummary & { itemCount: number };

export type TenderItem = { id: string } & TenderItemFields;

export type Tender = TenderSummary & {
  items: TenderItem[];
  assignees: { id: string; name: string }[];
};

const tenderColumns =
  "id, reference, client_name, title, date_received, internal_quote_deadline, " +
  "client_submission_deadline, expected_decision_date, submitted_at, notes, owner_user_id";

const itemColumns = "id, product_name, description, quantity, unit";

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
  items: { id: string }[];
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
    .insert(input.items.map((item) => itemRow(item, caller.orgId, data.id)));

  if (itemsError) {
    // PostgREST has no transaction across the two inserts, and a Tender with no Items
    // is a shape the rest of the app is entitled to assume cannot exist.
    await supabase.from("tenders").delete().eq("id", data.id);

    return { ok: false, reason: "failed" };
  }

  return { ok: true, tenderId: data.id, reference: data.reference };
}

export async function updateTender(
  { tenderId, ...input }: TenderFields & { tenderId: string },
  store: SessionCookieStore,
): Promise<TenderResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const problem = (await assignableProblem(input.ownerUserId, supabase)) ?? fieldProblem(input);

  if (problem) return { ok: false, reason: problem };

  const { data, error } = await supabase
    .from("tenders")
    .update(tenderRow(input))
    .eq("id", tenderId)
    .select("id");

  if (error !== null) return { ok: false, reason: "failed" };

  // RLS turns "another org's Tender" into "no rows matched", which is the same answer
  // as a Tender that was deleted while the form was open.
  return data.length === 1 ? { ok: true } : { ok: false, reason: "not_found" };
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

  const { data, error } = await supabase
    .from("tender_items")
    .insert(itemRow(item, caller.orgId, tenderId))
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
 * *doing* need derived Progress, which arrives with the Quotes it is derived from.
 */
export async function listTenders(store: SessionCookieStore): Promise<TenderListRow[]> {
  const { data } = await createSessionClient(store)
    .from("tenders")
    .select(
      `${tenderColumns}, owner:users!tenders_owner_user_id_fkey(name), items:tender_items(id)`,
    )
    .order("client_submission_deadline")
    .overrideTypes<TenderListDbRow[], { merge: false }>();

  return (data ?? []).map((row) => ({
    ...tenderSummary(row),
    itemCount: row.items.length,
  }));
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
    .order("created_at", { referencedTable: "tender_items" })
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

function itemRow(item: TenderItemFields, orgId: string, tenderId: string) {
  return { org_id: orgId, tender_id: tenderId, ...itemFields(item) };
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

  return data ? null : "not_found";
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

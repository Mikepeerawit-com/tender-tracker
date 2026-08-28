#!/usr/bin/env node
//
// Seeds one throwaway Tender — Item — Quote so the phone checks have something to
// stand on, and prints the deep link to the screen the camera button lives on.
//
// The photo controls hang off a *saved Quote row* (src/components/quotes/quote-list.tsx),
// so an empty deployment has nowhere to add a photo at all. That is what this fixes.
//
// Writes with the service role key, straight past RLS. It is a seeder for an empty
// deployment, not something to point at a database with real Tenders in it.
//
//   node --env-file=.env.local scripts/seed-mock-tender.mjs
//   node --env-file=.env.local scripts/seed-mock-tender.mjs --undo
//
// Against production, pull the environment first:
//   vercel env pull .env.production --environment=production
//   node --env-file=.env.production scripts/seed-mock-tender.mjs

import { createClient } from "@supabase/supabase-js";

// The title is the handle --undo deletes by. `reference` cannot be: it is issued by the
// tenders_assign_reference trigger, so the inserting side never knows what it got.
const MOCK_TITLE = "MOCK — phone check (safe to delete)";
const MOCK_CLIENT = "Mock Client Co.";
const MOCK_SUPPLIER = "Mock Supply Co.";

const undo = process.argv.includes("--undo");
const emailArg = process.argv.indexOf("--email");
const wantedEmail = emailArg === -1 ? null : process.argv[emailArg + 1];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
      "Run with --env-file, e.g. node --env-file=.env.local scripts/seed-mock-tender.mjs",
  );
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/** yyyy-mm-dd, `days` from today. */
function on(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

// ── who owns it ───────────────────────────────────────────────────────────
// Every row needs an org and a user: the Tender has an owner, the Quote records who
// sourced it, and the signed-in user has to be an assignee or the Quote form refuses
// with `not_assignee`.
const { data: users, error: usersError } = await db
  .from("users")
  .select("id, org_id, name, email, is_org_admin")
  .is("disabled_at", null);

if (usersError) die(`could not read users: ${usersError.message}`);
if (!users?.length) die("no users yet — sign up through /setup first.");

let user;

if (wantedEmail) {
  user = users.find((u) => u.email.toLowerCase() === wantedEmail.toLowerCase());
  if (!user) die(`no user with email ${wantedEmail}.`);
} else if (users.length === 1) {
  user = users[0];
} else {
  const admins = users.filter((u) => u.is_org_admin);
  if (admins.length !== 1) {
    die(
      "several users, so say which one owns this:\n    " +
        users.map((u) => `--email ${u.email}`).join("\n    "),
    );
  }
  user = admins[0];
}

// ── undo ──────────────────────────────────────────────────────────────────
// Items, quotes, photos and assignees all cascade from the Tender, so one delete is
// the whole of it. The supplier does not cascade and is left alone: it may have been
// there already, and an unused supplier row costs nothing.
if (undo) {
  const { data: gone, error } = await db
    .from("tenders")
    .delete()
    .eq("org_id", user.org_id)
    .eq("title", MOCK_TITLE)
    .select("reference");

  if (error) die(`could not delete: ${error.message}`);

  console.log(
    gone?.length
      ? `\n  Deleted ${gone.length}: ${gone.map((t) => t.reference).join(", ")}\n`
      : "\n  Nothing to delete.\n",
  );
  process.exit(0);
}

// ── the Tender ────────────────────────────────────────────────────────────
// Deadlines sit far out on purpose. Reminders fire at 3/1/0 days before the internal
// quote deadline and 7/3/1/0 before the client one (src/lib/reminders/schedule.ts), and
// a mock Tender that nudges a real WeCom group at 08:00 is not a mock any more.
// expected_decision_date stays null, which is what holds off the decision chase.
const { data: tender, error: tenderError } = await db
  .from("tenders")
  .insert({
    org_id: user.org_id,
    reference: "PENDING", // overwritten by the tenders_assign_reference trigger
    client_name: MOCK_CLIENT,
    title: MOCK_TITLE,
    date_received: on(0),
    internal_quote_deadline: on(80),
    client_submission_deadline: on(110),
    expected_decision_date: null,
    owner_user_id: user.id,
    notes: "Seeded by scripts/seed-mock-tender.mjs. Delete with --undo.",
  })
  .select("id, reference")
  .single();

if (tenderError) die(`could not create the tender: ${tenderError.message}`);

// Without this row the Quote form refuses with `not_assignee` and the camera button
// never gets a Quote to hang off.
const { error: assigneeError } = await db
  .from("tender_assignees")
  .insert({ tender_id: tender.id, user_id: user.id, org_id: user.org_id });

if (assigneeError) die(`could not assign you to it: ${assigneeError.message}`);

const { data: item, error: itemError } = await db
  .from("tender_items")
  .insert({
    org_id: user.org_id,
    tender_id: tender.id,
    product_name: "Mock widget, 12mm",
    description: "Seeded so the phone checks have a Quote to photograph.",
    quantity: 100,
    unit: "piece",
    // From 0, in entry order (tender_items.ordinal). First Item on a fresh Tender.
    ordinal: 0,
  })
  .select("id")
  .single();

if (itemError) die(`could not create the item: ${itemError.message}`);

// ── the Quote the camera button hangs off ─────────────────────────────────
const { data: existingSupplier } = await db
  .from("suppliers")
  .select("id")
  .eq("org_id", user.org_id)
  .ilike("name", MOCK_SUPPLIER)
  .maybeSingle();

let supplierId = existingSupplier?.id;

if (!supplierId) {
  const { data: supplier, error } = await db
    .from("suppliers")
    .insert({ org_id: user.org_id, name: MOCK_SUPPLIER })
    .select("id")
    .single();

  if (error) die(`could not create the supplier: ${error.message}`);
  supplierId = supplier.id;
}

// THB, so both rates are 1 and nothing here depends on Frankfurter being reachable.
const { error: quoteError } = await db.from("quotes").insert({
  org_id: user.org_id,
  tender_item_id: item.id,
  supplier_id: supplierId,
  created_by_user_id: user.id,
  unit_price: 42.5,
  currency: "THB",
  quoted_unit: "piece",
  fx_rate_mid: 1,
  fx_rate_applied: 1,
  fx_rate_as_of: on(0),
  fx_rate_is_stale: false,
  lead_time_days: 14,
  match_type: "exact",
  quoted_at: on(0),
});

if (quoteError) die(`could not create the quote: ${quoteError.message}`);

const app = process.env.MOCK_APP_URL ?? "https://tenders.mikepeerawit.com";

console.log(`
  Seeded ${tender.reference} — "${MOCK_TITLE}"
  Owned by and assigned to ${user.name} <${user.email}>

  The camera button is on the saved Quote row here:

    ${app}/tenders/${tender.id}/items/${item.id}/quote

  Deadlines are 80 and 110 days out and no decision date is set, so the nightly
  cron will not post anything about this to the WeCom group.

  Remove it with:  node --env-file=<the same file> scripts/seed-mock-tender.mjs --undo
`);

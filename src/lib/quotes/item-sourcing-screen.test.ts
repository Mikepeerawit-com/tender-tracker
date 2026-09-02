import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { selectQuote } from "@/lib/comparison/sheet";
import { imagesBucket } from "@/lib/images/images";
import { onePixelJpeg } from "@/lib/images/one-pixel-jpeg";
import { signQuotePhotoUploads, recordQuotePhotos } from "@/lib/images/quote-photos";
import {
  assignReferenceImage,
  recordReferenceImages,
  signReferenceImageUploads,
} from "@/lib/images/reference-images";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";
import { createStorageClient } from "@/lib/supabase/storage-client";
import { addAssignee, createTender, getTender } from "@/lib/tenders/tenders";

import { createQuote, recordNoSupplierFound } from "./quotes";
import { loadItemSourcingScreen } from "./item-sourcing-screen";

/**
 * Everything the item sourcing screen reads, in one call, against the real local Postgres.
 *
 * The page used to await eight times in a row and this loader issues the independent ones
 * together (#57). The point of testing it at all is that **one of those reads is not
 * independent**, and the way it fails is silent.
 *
 * `listQuotePhotosByQuote` takes the ids of the Quotes the Quotes read returned, and
 * returns an empty map when handed an empty list. Fold it into the same batch and it is
 * called before the ids exist: no error, no throw, no warning — a screen that renders
 * every Quote with no photos on any of them. Nothing else in this repo would notice,
 * because a Quote with no photos is a perfectly ordinary Quote.
 *
 * So the assertion that matters here is the boring-looking one: a Quote that *has* a
 * photo comes back with it. The rest of the cases hold the loader to returning the same
 * things the page used to compute inline — the Item's refusals rather than the Tender's,
 * and this Item's Reference Images rather than every Item's.
 *
 * Since #93 it answers a second question as well: **who is asking**. The suite at the
 * bottom is about that, and the fixture is built for it — a Tender owned by somebody who
 * sources nothing, two Assignees with a priced Quote apiece, and a colleague on neither.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

/** Owns the Tender and is an Assignee on nothing — the two are different answers. */
const owner = { id: "", email: `sourcing-owner-${run}@example.test` };
const assignee = { id: "", email: `sourcing-assignee-${run}@example.test` };
/** A second Assignee, so "not mine" can be told from "not the Owner's". */
const colleague = { id: "", email: `sourcing-colleague-${run}@example.test` };
/** A member enrolled on neither: the reader the enrol-yourself branch is drawn for. */
const outsider = { id: "", email: `sourcing-outsider-${run}@example.test` };

let orgId = "";
let tenderId = "";
let itemId = "";
let otherItemId = "";
let photographedQuoteId = "";
let bareQuoteId = "";
let rivalQuoteId = "";

/** Every object any fixture put in the bucket. Nothing cascades from a row into Storage. */
const objects: string[] = [];

async function signedInAs(email: string): Promise<SessionCookieStore> {
  const store = memoryCookieStore();
  const result = await signIn({ email, password }, store);

  if (!result.ok) throw new Error(`could not sign in as ${email}`);

  return store;
}

async function createOrg(name: string): Promise<string> {
  const { data, error } = await service
    .from("orgs")
    .insert({ name })
    .select("id")
    .single();

  if (error) throw error;

  return data.id;
}

async function createMember(org: string, who: { id: string; email: string }) {
  const { data, error } = await service.auth.admin.createUser({
    email: who.email,
    password,
    email_confirm: true,
  });

  if (error) throw error;

  who.id = data.user.id;

  const { error: profileError } = await service
    .from("users")
    .insert({ id: who.id, org_id: org, name: who.email, email: who.email });

  if (profileError) throw profileError;
}

/** A Tender with two Items, so "this Item's" can be told from "the Tender's". */
async function aTenderWithTwoItems(store: SessionCookieStore): Promise<void> {
  const result = await createTender(
    {
      clientName: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      dateReceived: "2026-08-01",
      internalQuoteDeadline: "2026-08-20",
      clientSubmissionDeadline: "2026-08-28",
      expectedDecisionDate: null,
      ownerUserId: owner.id,
      notes: null,
      items: [
        {
          productName: "Nitrile gloves, powder-free",
          description: null,
          quantity: 500,
          unit: "box of 50",
        },
        {
          productName: "Surgical mask, 3-ply",
          description: null,
          quantity: 2000,
          unit: "box of 50",
        },
      ],
    },
    store,
  );

  if (!result.ok) throw new Error(`could not create a Tender: ${result.reason}`);

  tenderId = result.tenderId;

  // The Owner is deliberately not among them: on this Tender they are the person the
  // Quotes are compared *by*, not one of the people competing.
  for (const who of [assignee, colleague]) {
    const added = await addAssignee({ tenderId, userId: who.id }, store);

    if (!added.ok) throw new Error(`could not assign ${who.email}: ${added.reason}`);
  }

  const tender = await getTender(tenderId, store);

  itemId = tender!.items[0].id;
  otherItemId = tender!.items[1].id;
}

async function aQuote(supplier: string, store: SessionCookieStore): Promise<string> {
  const quote = await createQuote(
    {
      tenderItemId: itemId,
      supplierName: supplier,
      unitPrice: 125.5,
      currency: "THB",
      quotedUnit: "box of 50",
      leadTimeDays: 14,
      matchType: "exact",
      alternativeProductName: null,
      detailNotes: null,
      quotedAt: "2026-08-18",
    },
    store,
  );

  if (!quote.ok) throw new Error(`could not create a Quote: ${quote.reason}`);

  return quote.quoteId;
}

/** Sign, upload and record one photo against a Quote, the way the uploader does. */
async function aPhotoOn(quoteId: string, store: SessionCookieStore): Promise<void> {
  const signed = await signQuotePhotoUploads(
    { quoteId, images: [{ contentType: "image/jpeg", byteSize: 240_000 }] },
    store,
  );

  if (!signed.ok) throw new Error(`could not sign an upload: ${signed.reason}`);

  const client = createStorageClient();

  for (const upload of signed.uploads) {
    objects.push(upload.storagePath);

    const { error } = await client.storage
      .from(imagesBucket)
      .uploadToSignedUrl(upload.storagePath, upload.token, onePixelJpeg());

    if (error) throw error;
  }

  const recorded = await recordQuotePhotos(
    { quoteId, storagePaths: signed.uploads.map((upload) => upload.storagePath) },
    store,
  );

  if (!recorded.ok) throw new Error(`could not record a photo: ${recorded.reason}`);
}

/** One Reference Image on the Tender, placed against `tenderItemId`. */
async function aReferenceImageOn(
  tenderItemId: string,
  store: SessionCookieStore,
): Promise<void> {
  const signed = await signReferenceImageUploads(
    { tenderId, images: [{ contentType: "image/jpeg", byteSize: 240_000 }] },
    store,
  );

  if (!signed.ok) throw new Error(`could not sign an upload: ${signed.reason}`);

  const client = createStorageClient();

  for (const upload of signed.uploads) {
    objects.push(upload.storagePath);

    const { error } = await client.storage
      .from(imagesBucket)
      .uploadToSignedUrl(upload.storagePath, upload.token, onePixelJpeg());

    if (error) throw error;
  }

  const recorded = await recordReferenceImages(
    { tenderId, storagePaths: signed.uploads.map((upload) => upload.storagePath) },
    store,
  );

  if (!recorded.ok) throw new Error(`could not record an image: ${recorded.reason}`);

  const assigned = await assignReferenceImage(
    { imageId: recorded.imageIds[0], tenderItemId },
    store,
  );

  if (!assigned.ok) throw new Error(`could not place an image: ${assigned.reason}`);
}

/** One reader, and the two things it takes to ask this loader a question as them. */
type Viewer = { id: string; store: SessionCookieStore };

let ownerViewer: Viewer;
let assigneeViewer: Viewer;
let colleagueViewer: Viewer;
let outsiderViewer: Viewer;

beforeAll(async () => {
  orgId = await createOrg(`Item sourcing ${run}`);

  for (const who of [owner, assignee, colleague, outsider]) {
    await createMember(orgId, who);
  }

  ownerViewer = { id: owner.id, store: await signedInAs(owner.email) };
  assigneeViewer = { id: assignee.id, store: await signedInAs(assignee.email) };
  colleagueViewer = { id: colleague.id, store: await signedInAs(colleague.email) };
  outsiderViewer = { id: outsider.id, store: await signedInAs(outsider.email) };

  await aTenderWithTwoItems(ownerViewer.store);

  photographedQuoteId = await aQuote(`Ace Medical ${run}`, assigneeViewer.store);
  bareQuoteId = await aQuote(`Siam Surgical ${run}`, assigneeViewer.store);
  // A rival's Quote, photographed too — so a photo map narrowed by nothing hands out a
  // signed read URL for a picture of somebody else's supplier's price list.
  rivalQuoteId = await aQuote(`Thonburi Trading ${run}`, colleagueViewer.store);

  await aPhotoOn(photographedQuoteId, assigneeViewer.store);
  await aPhotoOn(rivalQuoteId, colleagueViewer.store);

  // The Owner picks the rival's Quote, so the Selected Quote is a fact about a Quote only
  // one of the two Assignees has any business hearing about.
  const selected = await selectQuote(
    { tenderItemId: itemId, quoteId: rivalQuoteId },
    ownerViewer.store,
  );

  if (!selected.ok) throw new Error(`could not select a Quote: ${selected.reason}`);

  // One picture on this Item and one on the other, so a loader that forgot to narrow
  // them to the Item would come back with two.
  await aReferenceImageOn(itemId, ownerViewer.store);
  await aReferenceImageOn(otherItemId, ownerViewer.store);

  // A refusal on each Item, for the same reason — and two on the other Item, so "whose
  // refusals" is a question with a visible answer.
  const mine = await recordNoSupplierFound(
    { tenderItemId: itemId, note: "MOQ too high" },
    assigneeViewer.store,
  );
  const theirs = await recordNoSupplierFound(
    { tenderItemId: otherItemId, note: null },
    colleagueViewer.store,
  );
  const alsoMine = await recordNoSupplierFound(
    { tenderItemId: otherItemId, note: "Nobody stocks 3-ply at that volume" },
    assigneeViewer.store,
  );

  if (!mine.ok || !theirs.ok || !alsoMine.ok) {
    throw new Error("could not record a refusal");
  }
});

afterAll(async () => {
  await service.from("tenders").delete().eq("org_id", orgId);
  await service.from("suppliers").delete().eq("org_id", orgId);

  if (objects.length > 0) {
    await service.storage.from(imagesBucket).remove(objects);
  }

  const memberIds = [owner.id, assignee.id, colleague.id, outsider.id].filter(Boolean);

  await service.from("users").delete().in("id", memberIds);

  for (const id of memberIds) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().eq("id", orgId);
});

/** The screen as one reader gets it. `withMembers` is off unless a case is about it. */
const load = (who: Viewer, tenderItemId: string, withMembers = false) =>
  loadItemSourcingScreen(
    { tenderId, tenderItemId, withMembers, ownerUserId: owner.id, callerId: who.id },
    who.store,
  );

describe("loading the item sourcing screen", () => {
  it("gives the photos read the Quote ids the Quotes read returned", async () => {
    const screen = await load(ownerViewer, itemId);

    // The regression the batch would cause, stated the way a reader sees it: the Quote
    // that has a photo comes back with it.
    expect(screen.photos.get(photographedQuoteId)).toHaveLength(1);
  });

  it("returns every Quote on the Item to the Owner, photographed or not", async () => {
    const screen = await load(ownerViewer, itemId);

    expect(screen.quotes.map((quote) => quote.id).sort()).toEqual(
      [photographedQuoteId, bareQuoteId, rivalQuoteId].sort(),
    );
    // A Quote with no photos is absent from the map rather than present and empty, which
    // is what `listQuotePhotosByQuote` has always done and what `QuoteList` expects.
    expect(screen.photos.has(bareQuoteId)).toBe(false);
  });

  it("narrows the refusals to this Item, not the Tender's", async () => {
    const screen = await load(ownerViewer, itemId);

    expect(screen.refusals.map((refusal) => refusal.userId)).toEqual([assignee.id]);
    expect(screen.refusals[0].note).toBe("MOQ too high");
  });

  it("narrows the Reference Images to this Item, not the Tender's", async () => {
    const screen = await load(ownerViewer, itemId);

    expect(screen.referenceImages).toHaveLength(1);
    expect(screen.referenceImages[0].tenderItemId).toBe(itemId);
  });

  it("reads an Item nobody has quoted as no Quotes and no photos", async () => {
    // The empty case is the one the folded-batch bug renders as *every* case, so it is
    // worth pinning that it really is empty here rather than incidentally.
    const screen = await load(ownerViewer, otherItemId);

    expect(screen.quotes).toEqual([]);
    expect(screen.photos.size).toBe(0);
    expect(screen.refusals.map((refusal) => refusal.userId).sort()).toEqual(
      [assignee.id, colleague.id].sort(),
    );
  });

  it("carries the org's timezone, which every visit needs", async () => {
    // Where the screen's `today` comes from, and the one read here with nothing to do
    // with the Item.
    expect((await load(ownerViewer, itemId)).timezone).toBe("Asia/Bangkok");
  });

  it("reads the org's members only when the screen will offer them", async () => {
    // The screen draws the enrol-yourself control on one branch, and an Assignee entering
    // price after price off a run of supplier calls is never on it. `null` says the read
    // did not happen; `[]` would say the org has nobody left to enrol, which is a
    // different answer and one this call never asked for.
    expect((await load(assigneeViewer, itemId)).members).toBeNull();

    const offered = await load(outsiderViewer, itemId, true);

    expect(offered.members?.map((member) => member.id).sort()).toEqual(
      [owner.id, assignee.id, colleague.id, outsider.id].sort(),
    );
  });
});

/**
 * ADR-0020 on the screen an Assignee actually opens most (#93).
 *
 * #92 closed the comparison sheet on the Tender detail. This screen is one tap further in
 * and had the same leak in a worse place: an Assignee with a price to enter comes here
 * several times per Item, and every visit listed their rivals' suppliers and prices.
 *
 * **How these were verified able to fail** (ADR-0016). The narrowing is three statements
 * in `loadItemSourcingScreen`, and each was reverted separately rather than all at once,
 * because reverting the lot only proves that *something* narrows. Counts are of this
 * whole file, sixteen tests:
 *
 * | what was reverted in `item-sourcing-screen.ts`      | tests red |
 * | --------------------------------------------------- | --------- |
 * | `quotes` left as everything `listQuotes` returned    | 6         |
 * | the photos read handed every Quote id                | 3         |
 * | `selectedQuoteId` passed through unnarrowed          | 3         |
 * | `ownsTender` forced to `true` (everybody the Owner)  | 7         |
 * | `ownsTender` forced to `false` (nobody the Owner)    | 4         |
 *
 * The first row is the widest because the other two read off `quotes`: leaving it whole
 * re-widens the photo map and the Selected Quote along with it. The middle two are the
 * rows worth having, since each is a leak that survives a correct Quote list.
 *
 * The refusals have no row here, and that is the decision rather than an omission — see
 * the case that names it, and the field's own note in `item-sourcing-screen.ts`.
 */
describe("what each viewer is handed", () => {
  it("hands a non-Owner Assignee their own Quotes and nobody else's", async () => {
    const screen = await load(assigneeViewer, itemId);

    expect(screen.quotes.map((quote) => quote.id).sort()).toEqual(
      [photographedQuoteId, bareQuoteId].sort(),
    );
    // Said as the rule as well as the list, because the list is what needs updating and
    // the rule is what is being kept.
    expect(screen.quotes.every((quote) => quote.sourcedByUserId === assignee.id)).toBe(
      true,
    );
  });

  it("hands the other Assignee theirs, which is the first one's rival", async () => {
    const screen = await load(colleagueViewer, itemId);

    expect(screen.quotes.map((quote) => quote.id)).toEqual([rivalQuoteId]);
  });

  it("keeps no price sourced by anybody else anywhere in the shape", async () => {
    const screen = await load(assigneeViewer, itemId);

    // The whole object, not just the Quote list: a rival's Quote surviving on some other
    // field — a photo key, the Selected Quote — would be just as read.
    const handedBack = JSON.stringify([...Object.entries(screen), [...screen.photos]]);

    expect(handedBack).not.toContain(rivalQuoteId);
    expect(handedBack).not.toContain(`Thonburi Trading ${run}`);
  });

  it("hands out no photo of a Quote that is not the reader's", async () => {
    // These are signed read URLs good for the hour. A map still keyed by a rival's Quote
    // would be handing out a picture of their supplier's price list, which is the leak in
    // its most literal form.
    const screen = await load(assigneeViewer, itemId);

    expect(screen.photos.has(rivalQuoteId)).toBe(false);
    expect(screen.photos.get(photographedQuoteId)).toHaveLength(1);
  });

  it("says whose list it handed back, so the screen's words can match it", async () => {
    // The heading over this list counts it and names it. `false` draws "3 quotes
    // recorded" — a claim about the Item — and `true` draws "2 quotes from you".
    expect((await load(ownerViewer, itemId)).yourQuotesOnly).toBe(false);
    expect((await load(assigneeViewer, itemId)).yourQuotesOnly).toBe(true);
    expect((await load(outsiderViewer, itemId)).yourQuotesOnly).toBe(true);
  });

  it("keeps the Selected Quote only when it is one of the reader's own", async () => {
    // Deleting the Selected Quote clears the Item's selection, and the row offering that
    // delete is the only place able to warn first — so the reader whose Quote was picked
    // keeps it. To the other Assignee it names a Quote that is not in their shape at all.
    expect((await load(ownerViewer, itemId)).selectedQuoteId).toBe(rivalQuoteId);
    expect((await load(colleagueViewer, itemId)).selectedQuoteId).toBe(rivalQuoteId);
    expect((await load(assigneeViewer, itemId)).selectedQuoteId).toBeNull();
  });

  it("shows a non-Owner every refusal on the Item, including other people's", async () => {
    // The decision, pinned: a refusal is not a price. See the note on `refusals` in
    // `item-sourcing-screen.ts` for why this one is not narrowed with the Quotes.
    const screen = await load(assigneeViewer, otherItemId);

    expect(screen.refusals.map((refusal) => refusal.userId).sort()).toEqual(
      [assignee.id, colleague.id].sort(),
    );
  });

  it("leaves a non-Owner the Item's brief and its Reference Images", async () => {
    // What the reduced screen keeps is the whole of the reader's own job, and the
    // client's own pictures are the half of it a supplier is actually asked about.
    const screen = await load(assigneeViewer, itemId);

    expect(screen.referenceImages).toHaveLength(1);
    expect(screen.timezone).toBe("Asia/Bangkok");
  });

  it("hands somebody enrolled on neither an empty list rather than everybody's", async () => {
    // Not an Assignee and not the Owner: they have sourced nothing, so their own Quotes
    // are none. This is the branch that draws the enrol-yourself control, and it used to
    // draw the whole Item's prices above it.
    const screen = await load(outsiderViewer, itemId, true);

    expect(screen.quotes).toEqual([]);
    expect(screen.photos.size).toBe(0);
    expect(screen.selectedQuoteId).toBeNull();
  });
});

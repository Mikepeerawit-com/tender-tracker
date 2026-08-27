import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
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
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const assignee = { id: "", email: `sourcing-assignee-${run}@example.test` };
const colleague = { id: "", email: `sourcing-colleague-${run}@example.test` };

let orgId = "";
let tenderId = "";
let itemId = "";
let otherItemId = "";
let photographedQuoteId = "";
let bareQuoteId = "";

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
      ownerUserId: assignee.id,
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

let store: SessionCookieStore;

beforeAll(async () => {
  orgId = await createOrg(`Item sourcing ${run}`);

  await createMember(orgId, assignee);
  await createMember(orgId, colleague);

  store = await signedInAs(assignee.email);

  await aTenderWithTwoItems(store);

  photographedQuoteId = await aQuote(`Ace Medical ${run}`, store);
  bareQuoteId = await aQuote(`Siam Surgical ${run}`, store);

  await aPhotoOn(photographedQuoteId, store);

  // One picture on this Item and one on the other, so a loader that forgot to narrow
  // them to the Item would come back with two.
  await aReferenceImageOn(itemId, store);
  await aReferenceImageOn(otherItemId, store);

  // A refusal on each Item, for the same reason.
  const colleagueStore = await signedInAs(colleague.email);
  const mine = await recordNoSupplierFound({ tenderItemId: itemId, note: "MOQ too high" }, store);
  const theirs = await recordNoSupplierFound(
    { tenderItemId: otherItemId, note: null },
    colleagueStore,
  );

  if (!mine.ok || !theirs.ok) throw new Error("could not record a refusal");
});

afterAll(async () => {
  await service.from("tenders").delete().eq("org_id", orgId);
  await service.from("suppliers").delete().eq("org_id", orgId);

  if (objects.length > 0) {
    await service.storage.from(imagesBucket).remove(objects);
  }

  const memberIds = [assignee.id, colleague.id].filter(Boolean);

  await service.from("users").delete().in("id", memberIds);

  for (const id of memberIds) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().eq("id", orgId);
});

describe("loading the item sourcing screen", () => {
  it("gives the photos read the Quote ids the Quotes read returned", async () => {
    const screen = await loadItemSourcingScreen({ tenderId, tenderItemId: itemId }, store);

    // The regression the batch would cause, stated the way a reader sees it: the Quote
    // that has a photo comes back with it.
    expect(screen.photos.get(photographedQuoteId)).toHaveLength(1);
  });

  it("returns every Quote on the Item, photographed or not", async () => {
    const screen = await loadItemSourcingScreen({ tenderId, tenderItemId: itemId }, store);

    expect(screen.quotes.map((quote) => quote.id).sort()).toEqual(
      [photographedQuoteId, bareQuoteId].sort(),
    );
    // A Quote with no photos is absent from the map rather than present and empty, which
    // is what `listQuotePhotosByQuote` has always done and what `QuoteList` expects.
    expect(screen.photos.has(bareQuoteId)).toBe(false);
  });

  it("narrows the refusals to this Item, not the Tender's", async () => {
    const screen = await loadItemSourcingScreen({ tenderId, tenderItemId: itemId }, store);

    expect(screen.refusals.map((refusal) => refusal.userId)).toEqual([assignee.id]);
    expect(screen.refusals[0].note).toBe("MOQ too high");
  });

  it("narrows the Reference Images to this Item, not the Tender's", async () => {
    const screen = await loadItemSourcingScreen({ tenderId, tenderItemId: itemId }, store);

    expect(screen.referenceImages).toHaveLength(1);
    expect(screen.referenceImages[0].tenderItemId).toBe(itemId);
  });

  it("reads an Item nobody has sourced as no Quotes, no photos and no refusals", async () => {
    // The empty case is the one the folded-batch bug renders as *every* case, so it is
    // worth pinning that it really is empty here rather than incidentally.
    const screen = await loadItemSourcingScreen(
      { tenderId, tenderItemId: otherItemId },
      store,
    );

    expect(screen.quotes).toEqual([]);
    expect(screen.photos.size).toBe(0);
    expect(screen.refusals.map((refusal) => refusal.userId)).toEqual([colleague.id]);
  });

  it("carries the org's timezone and its members", async () => {
    const screen = await loadItemSourcingScreen({ tenderId, tenderItemId: itemId }, store);

    // Where the screen's `today` is computed, and what the enrol-yourself control offers
    // — the two reads that have nothing to do with the Item and were awaited anyway.
    expect(screen.timezone).toBe("Asia/Bangkok");
    expect(screen.members.map((member) => member.id).sort()).toEqual(
      [assignee.id, colleague.id].sort(),
    );
  });
});

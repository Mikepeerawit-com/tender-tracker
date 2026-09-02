import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { setLandedCost, setSellingPrice } from "@/lib/comparison/sheet";
import { imagesBucket } from "@/lib/images/images";
import { onePixelJpeg } from "@/lib/images/one-pixel-jpeg";
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
import { respondingRates } from "@/lib/fx/rate-stub";
import { createQuote, recordNoSupplierFound } from "@/lib/quotes/quotes";
import {
  recordQuotePhotos,
  signQuotePhotoUploads,
} from "@/lib/images/quote-photos";
import {
  addAssignee,
  createTender,
  getTender,
  recordSubmission,
  setItemOutcome,
} from "@/lib/tenders/tenders";

import { loadTenderScreen, type TenderScreenData } from "./tender-screen";

/**
 * Everything screen 5 reads, in one batch, against the real local Postgres.
 *
 * The page awaited six times in a row; this loader issues all five reads together. What
 * makes that worth a test is the thing the batch gives up: the old page read `getTender`
 * **first** and bailed on `notFound()` before anything else ran, so the other four reads
 * were only ever handed an id that existed. Now they all start at once, which means every
 * one of them is called with a `tenderId` that may answer nothing at all — a mistyped
 * link, or another org's id, which RLS makes indistinguishable.
 *
 * A read that threw on that instead of coming back empty would turn a 404 into a 500, and
 * it would do it only on the path nobody exercises by hand. So the assertions that matter
 * here are the two that look like nothing: a Tender that does not exist, and a Tender
 * belonging to somebody else, both come back as `tender: null` with the rest of the shape
 * intact and no throw.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const owner = { id: "", email: `screen-owner-${run}@example.test` };
/** A second Assignee on the same Tender, so "what *you* owe" can be told from "what the team owes". */
const mate = { id: "", email: `screen-mate-${run}@example.test` };
/** A third Assignee, so "not mine" can be told from "not the Owner's". */
const rival = { id: "", email: `screen-rival-${run}@example.test` };
/** In the org, on nothing: the reader the enrol-yourself path exists for. */
const bystander = { id: "", email: `screen-bystander-${run}@example.test` };
/** An Org Admin who owns nothing here, because a capability is not a rank. */
const admin = { id: "", email: `screen-admin-${run}@example.test` };
const outsider = { id: "", email: `screen-outsider-${run}@example.test` };

let orgId = "";
let otherOrgId = "";
let tenderId = "";
let itemId = "";
let otherItemId = "";

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

async function createMember(
  org: string,
  who: { id: string; email: string },
  { isOrgAdmin = false }: { isOrgAdmin?: boolean } = {},
) {
  const { data, error } = await service.auth.admin.createUser({
    email: who.email,
    password,
    email_confirm: true,
  });

  if (error) throw error;

  who.id = data.user.id;

  const { error: profileError } = await service
    .from("users")
    .insert({
      id: who.id,
      org_id: org,
      name: who.email,
      email: who.email,
      is_org_admin: isOrgAdmin,
    });

  if (profileError) throw profileError;
}

/** The ids a fixture Tender is referred to by afterwards. */
type FixtureTender = { tenderId: string; itemId: string; otherItemId: string };

/**
 * A Tender with two Items, so "unassigned" can be told from "placed on an Item".
 *
 * It hands its ids back rather than assigning them, because there are two fixtures in
 * this file now: the one every test below shares and mutates, and the untouched one the
 * per-viewer suite reads.
 */
async function aTenderWithTwoItems(
  title: string,
  store: SessionCookieStore,
): Promise<FixtureTender> {
  const result = await createTender(
    {
      clientName: "Bangkok General Hospital",
      title,
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

  const tender = await getTender(result.tenderId, store);

  return {
    tenderId: result.tenderId,
    itemId: tender!.items[0].id,
    otherItemId: tender!.items[1].id,
  };
}

/**
 * One Reference Image on the Tender. Placed against `tenderItemId`, or left Unassigned
 * when that is null — which is the state every Reference Image starts in.
 */
async function aReferenceImage(
  { tender, tenderItemId }: { tender: string; tenderItemId: string | null },
  store: SessionCookieStore,
): Promise<void> {
  const signed = await signReferenceImageUploads(
    { tenderId: tender, images: [{ contentType: "image/jpeg", byteSize: 240_000 }] },
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
    { tenderId: tender, storagePaths: signed.uploads.map((upload) => upload.storagePath) },
    store,
  );

  if (!recorded.ok) throw new Error(`could not record an image: ${recorded.reason}`);

  if (tenderItemId === null) return;

  const assigned = await assignReferenceImage(
    { imageId: recorded.imageIds[0], tenderItemId },
    store,
  );

  if (!assigned.ok) throw new Error(`could not place an image: ${assigned.reason}`);
}

let store: SessionCookieStore;
let mateStore: SessionCookieStore;
let rivalStore: SessionCookieStore;
let bystanderStore: SessionCookieStore;
let adminStore: SessionCookieStore;
let outsiderStore: SessionCookieStore;

beforeAll(async () => {
  orgId = await createOrg(`Tender screen ${run}`);
  otherOrgId = await createOrg(`Tender screen outsiders ${run}`);

  await createMember(orgId, owner);
  await createMember(orgId, mate);
  await createMember(orgId, rival);
  await createMember(orgId, bystander);
  await createMember(orgId, admin, { isOrgAdmin: true });
  await createMember(otherOrgId, outsider);

  store = await signedInAs(owner.email);
  mateStore = await signedInAs(mate.email);
  rivalStore = await signedInAs(rival.email);
  bystanderStore = await signedInAs(bystander.email);
  adminStore = await signedInAs(admin.email);
  outsiderStore = await signedInAs(outsider.email);

  ({ tenderId, itemId, otherItemId } = await aTenderWithTwoItems(
    "Surgical consumables Q3",
    store,
  ));

  // Both are Assignees, which under ADR-0004 is what makes either of them owe anything
  // at all: Assignees compete rather than divide, so both owe both Items to begin with.
  for (const who of [owner, mate]) {
    const added = await addAssignee({ tenderId, userId: who.id }, store);

    if (!added.ok) throw new Error(`could not assign: ${added.reason}`);
  }

  // One placed on each Item and one left Unassigned, so a loader that split them wrongly
  // would come back with three in the unassigned pile or none.
  await aReferenceImage({ tender: tenderId, tenderItemId: itemId }, store);
  await aReferenceImage({ tender: tenderId, tenderItemId: otherItemId }, store);
  await aReferenceImage({ tender: tenderId, tenderItemId: null }, store);
});

afterAll(async () => {
  for (const org of [orgId, otherOrgId]) {
    await service.from("tenders").delete().eq("org_id", org);
    await service.from("suppliers").delete().eq("org_id", org);
  }

  if (objects.length > 0) {
    await service.storage.from(imagesBucket).remove(objects);
  }

  const memberIds = [
    owner.id,
    mate.id,
    rival.id,
    bystander.id,
    admin.id,
    outsider.id,
  ].filter(Boolean);

  await service.from("users").delete().in("id", memberIds);

  for (const id of memberIds) {
    await service.auth.admin.deleteUser(id);
  }

  for (const org of [orgId, otherOrgId]) {
    await service.from("orgs").delete().eq("id", org);
  }
});

/** One Quote against an Item, entered by whoever the store is signed in as. */
async function aQuote(
  {
    tenderItemId,
    supplierName = "Ace Medical",
    unitPrice = 125.5,
  }: { tenderItemId: string; supplierName?: string; unitPrice?: number },
  as: SessionCookieStore,
): Promise<string> {
  const result = await createQuote(
    {
      tenderItemId,
      supplierName,
      unitPrice,
      currency: "THB",
      quotedUnit: "box of 50",
      leadTimeDays: 14,
      matchType: "exact",
      alternativeProductName: null,
      detailNotes: null,
      quotedAt: "2026-08-05",
    },
    as,
    respondingRates(1),
  );

  if (!result.ok) throw new Error(`could not enter a Quote: ${result.reason}`);

  return result.quoteId;
}

/** One photo on one Quote, uploaded the way the phone does it. */
async function aQuotePhoto(quoteId: string, as: SessionCookieStore): Promise<void> {
  const signed = await signQuotePhotoUploads(
    { quoteId, images: [{ contentType: "image/jpeg", byteSize: 240_000 }] },
    as,
  );

  if (!signed.ok) throw new Error(`could not sign a photo: ${signed.reason}`);

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
    as,
  );

  if (!recorded.ok) throw new Error(`could not record a photo: ${recorded.reason}`);
}

/**
 * The two shapes the loader answers with, asserted as such.
 *
 * `viewer` is a discriminant rather than a permission flag, so reaching either half of
 * the union means saying which half you expected — which is the assertion, not a
 * formality on the way to one. A test that meant to read the Owner's sheet and was handed
 * the reduced shape fails here rather than three lines later on `undefined`.
 */
function ownersScreen(screen: TenderScreenData) {
  if (screen.viewer !== "owner") {
    throw new Error(`expected the Owner's screen, got the ${screen.viewer}'s`);
  }

  return screen;
}

function reducedScreen(screen: TenderScreenData) {
  if (screen.viewer !== "assignee") {
    throw new Error(`expected the reduced screen, got the ${screen.viewer}'s`);
  }

  return screen;
}

describe("loading the tender screen", () => {
  it("returns the Tender with everything the screen draws beside it", async () => {
    const screen = await loadTenderScreen(tenderId, owner.id, store);

    expect(screen.tender?.id).toBe(tenderId);
    expect(ownersScreen(screen).sheet.items).toHaveLength(2);
    expect(screen.members.map((member) => member.id)).toContain(owner.id);
    expect(screen.timezone).toBeTruthy();
    expect(screen.referenceImages).toHaveLength(3);
  });

  it("separates the Reference Images nobody has placed yet", async () => {
    const screen = await loadTenderScreen(tenderId, owner.id, store);

    expect(screen.unassignedImages).toHaveLength(1);
    expect(screen.unassignedImages[0].tenderItemId).toBeNull();
    // The other two are still in the full list — split, not filtered out.
    expect(screen.referenceImages.filter((image) => image.tenderItemId !== null))
      .toHaveLength(2);
  });

  it("answers a Tender that does not exist with null, rather than throwing", async () => {
    // The batch runs all five reads against this id. Every one of them has to survive it,
    // or the page's `notFound()` never gets the chance to run.
    const screen = await loadTenderScreen(crypto.randomUUID(), owner.id, store);

    expect(screen.tender).toBeNull();
    // A Tender nobody can read is nobody's to own, so the reduced shape is what comes
    // back — fail-closed, on the path where the page is about to call `notFound()`.
    expect(reducedScreen(screen).items).toEqual([]);
    expect(screen.referenceImages).toEqual([]);
    expect(screen.unassignedImages).toEqual([]);
  });

  it("names the Items this reader has not answered for", async () => {
    const screen = await loadTenderScreen(tenderId, owner.id, store);

    expect(screen.outstandingForYou.map((item) => item.id).sort()).toEqual(
      [itemId, otherItemId].sort(),
    );
    expect(screen.outstandingForYou.map((item) => item.productName)).toContain(
      "Nitrile gloves, powder-free",
    );
  });

  it("drops an Item once this reader has entered a Quote on it", async () => {
    await aQuote({ tenderItemId: itemId }, store);

    const screen = await loadTenderScreen(tenderId, owner.id, store);

    expect(screen.outstandingForYou.map((item) => item.id)).toEqual([otherItemId]);
  });

  it("treats No Supplier Found as an answer, not as a gap", async () => {
    // The whole reason the third sourcing state exists. "Nobody could supply this" and
    // "nobody tried" mean opposite things, and only one of them is worth a nag.
    const recorded = await recordNoSupplierFound(
      { tenderItemId: otherItemId, note: "Discontinued." },
      store,
    );

    expect(recorded.ok).toBe(true);

    const screen = await loadTenderScreen(tenderId, owner.id, store);

    expect(screen.outstandingForYou).toEqual([]);
  });

  it("is unmoved by what another Assignee has or has not done", async () => {
    // The Owner answered for both Items in the two tests above. The colleague has
    // answered for neither, and still owes both — a band that reported the *team's*
    // outstanding work would now be empty for them, which is precisely the report this
    // is not.
    const theirs = await loadTenderScreen(tenderId, mate.id, mateStore);

    expect(theirs.outstandingForYou.map((item) => item.id).sort()).toEqual(
      [itemId, otherItemId].sort(),
    );

    // And the Owner, who answered for both, is still owed nothing by their colleague's
    // silence.
    const mine = await loadTenderScreen(tenderId, owner.id, store);

    expect(mine.outstandingForYou).toEqual([]);
  });

  it("owes nothing to somebody who is not an Assignee", async () => {
    // Under ADR-0004 only an Assignee may enter a Quote, and Assignees enrol themselves.
    // Every Item would otherwise read as outstanding for a reader who cannot act on any
    // of them, with links to a screen that would refuse them.
    const stranger = await loadTenderScreen(tenderId, outsider.id, store);

    expect(stranger.outstandingForYou).toEqual([]);
  });

  it("answers another org's Tender the same way, and reads none of it", async () => {
    // RLS makes this identical to the case above, which is the point: the outsider learns
    // nothing about whether this id exists. The four reads that now run before anyone has
    // checked must come back empty rather than error.
    const screen = await loadTenderScreen(tenderId, outsider.id, outsiderStore);

    expect(screen.tender).toBeNull();
    expect(reducedScreen(screen).items).toEqual([]);
    expect(screen.referenceImages).toEqual([]);
  });

  // The two below are read through the colleague, who has answered for neither Item and
  // so still owes both. They are the only reader on this fixture with anything left to
  // owe, which is what makes a band that empties visible at all.

  it("drops an Item somebody has recorded an Outcome on", async () => {
    // Nobody is going to price an Item the Owner decided not to bid. Naming it would link
    // an Assignee to a sourcing screen for work that will never be done.
    const decided = await setItemOutcome(
      { itemId, outcome: "no_bid", decidedAt: new Date("2026-08-22T03:00:00Z") },
      store,
    );

    expect(decided.ok).toBe(true);

    const theirs = await loadTenderScreen(tenderId, mate.id, mateStore);

    expect(theirs.outstandingForYou.map((item) => item.id)).toEqual([otherItemId]);
  });

  it("owes nothing once the Bid has gone out", async () => {
    // Sourcing a price for a Tender already with the client changes nothing — the same
    // reading ADR-0005 takes when it stops nagging one. The colleague still owes the
    // second Item by every other measure, and the band goes quiet anyway.
    const submitted = await recordSubmission(
      { tenderId, submittedAt: new Date("2026-08-27T09:00:00Z") },
      store,
    );

    expect(submitted.ok).toBe(true);

    const theirs = await loadTenderScreen(tenderId, mate.id, mateStore);

    expect(theirs.outstandingForYou).toEqual([]);
    // Still the Tender, still every Item — it is the band that emptied, not the screen.
    expect(theirs.tender?.id).toBe(tenderId);
    expect(reducedScreen(theirs).items).toHaveLength(2);
  });
});

/**
 * Who is looking, and what they are therefore handed (ADR-0020, #92).
 *
 * A fixture of its own, and that is the half of this that matters. Every fixture in this
 * file above answers the same shape to everybody, which is exactly why the leak it
 * describes was invisible: an Owner and an Assignee were indistinguishable to the loader,
 * so nothing could assert that they should not be. This one has an Owner who is not an
 * Assignee, two Assignees who are not the Owner, a colleague on neither, and an Org
 * Admin — and every Assignee's Quote carries a supplier name and a price that belongs to
 * nobody else, so "none of the other Assignee's" is a string search rather than a count.
 *
 * It is never mutated by the tests that read it, except the last two, which say so.
 */
describe("what each viewer is handed", () => {
  const priced = { landedCost: 7654.25, sellingPrice: 98765.5 };

  let viewed: FixtureTender;

  beforeAll(async () => {
    viewed = await aTenderWithTwoItems("Ward refit, phase two", store);

    // The Owner is deliberately *not* among them: "Owner" and "Assignee" are two
    // different answers on this Tender, and the last test in this suite is what makes
    // somebody both.
    for (const who of [mate, rival]) {
      const added = await addAssignee({ tenderId: viewed.tenderId, userId: who.id }, store);

      if (!added.ok) throw new Error(`could not assign: ${added.reason}`);
    }

    const mine = await aQuote(
      { tenderItemId: viewed.itemId, supplierName: "Mate Trading", unitPrice: 222.22 },
      mateStore,
    );
    const theirs = await aQuote(
      { tenderItemId: viewed.itemId, supplierName: "Rival Imports", unitPrice: 333.33 },
      rivalStore,
    );

    // A photo on each, because the photo map is keyed by Quote and a map that carried a
    // rival's key would hand a signed URL to somebody with no business holding one.
    await aQuotePhoto(mine, mateStore);
    await aQuotePhoto(theirs, rivalStore);

    const cost = await setLandedCost(
      {
        tenderItemId: viewed.itemId,
        landedCostPerUnit: priced.landedCost,
        confirmedAt: new Date("2026-08-10T04:00:00Z"),
      },
      store,
    );

    if (!cost.ok) throw new Error(`could not price: ${cost.reason}`);

    const selling = await setSellingPrice(
      { tenderItemId: viewed.itemId, sellingPricePerUnit: priced.sellingPrice },
      store,
    );

    if (!selling.ok) throw new Error(`could not price: ${selling.reason}`);

    // One Assignee gave up on the second Item, with a note nobody else should read.
    const gaveUp = await recordNoSupplierFound(
      { tenderItemId: viewed.otherItemId, note: "Rival rang four and got nowhere." },
      rivalStore,
    );

    if (!gaveUp.ok) throw new Error(`could not refuse: ${gaveUp.reason}`);

    await aReferenceImage(
      { tender: viewed.tenderId, tenderItemId: viewed.itemId },
      store,
    );
  });

  /**
   * The whole answer as one string, `Map`s expanded.
   *
   * "Nowhere in the returned shape" is the acceptance criterion, and a field-by-field
   * assertion cannot say that — it can only say the fields somebody thought of are
   * clean. This walks everything that would be serialised into the client payload,
   * including the photo map, which `JSON.stringify` would otherwise render as `{}` and
   * report as empty however much was in it.
   */
  function everythingIn(screen: TenderScreenData): string {
    return JSON.stringify(screen, (_key, value: unknown) =>
      value instanceof Map ? Object.fromEntries(value) : value,
    );
  }

  it("hands the Owner the whole sheet, exactly as before", async () => {
    const screen = ownersScreen(
      await loadTenderScreen(viewed.tenderId, owner.id, store),
    );
    const [first] = screen.sheet.items;

    expect(screen.sheet.items).toHaveLength(2);
    expect(first.quotes.map((quote) => quote.supplierName).sort()).toEqual([
      "Mate Trading",
      "Rival Imports",
    ]);
    expect(first.landedCostPerUnit).toBe(priced.landedCost);
    expect(first.sellingPricePerUnit).toBe(priced.sellingPrice);
    expect(screen.sheet.photos.size).toBe(2);
  });

  it("hands a non-Owner Assignee their own Quotes and nobody else's", async () => {
    const screen = reducedScreen(
      await loadTenderScreen(viewed.tenderId, mate.id, mateStore),
    );
    const [first] = screen.items;

    expect(first.yourQuotes.map((quote) => quote.supplierName)).toEqual([
      "Mate Trading",
    ]);
    expect(first.yourQuotes[0].sourcedByUserId).toBe(mate.id);

    // Not "the array is length one": the rival's price must be absent from the whole
    // answer, photo map and all, not merely from the field somebody remembered to check.
    const everything = everythingIn(screen);

    expect(everything).toContain("Mate Trading");
    expect(everything).not.toContain("Rival Imports");
    expect(everything).not.toContain("333.33");
    expect([...screen.photos.keys()]).toEqual([first.yourQuotes[0].id]);
  });

  it("hands a non-Owner Assignee no money figure at all", async () => {
    const screen = reducedScreen(
      await loadTenderScreen(viewed.tenderId, mate.id, mateStore),
    );
    const everything = everythingIn(screen);

    // The figures themselves, and then the fields that would carry them: Coverage is
    // counted from `landedCostPerUnit` being set, so a shape without the field cannot
    // have a Coverage derived from it either.
    expect(everything).not.toContain(String(priced.landedCost));
    expect(everything).not.toContain(String(priced.sellingPrice));
    expect(everything).not.toMatch(/landedCost|sellingPrice|selectedQuote/i);
  });

  it("keeps every Item and the Reference Images for a non-Owner Assignee", async () => {
    const screen = reducedScreen(
      await loadTenderScreen(viewed.tenderId, mate.id, mateStore),
    );

    expect(screen.items.map((item) => item.productName)).toEqual([
      "Nitrile gloves, powder-free",
      "Surgical mask, 3-ply",
    ]);
    expect(screen.tender?.items).toHaveLength(2);
    expect(screen.referenceImages).toHaveLength(1);
    expect(screen.referenceImages[0].tenderItemId).toBe(viewed.itemId);
  });

  it("shows a non-Owner Assignee their own No Supplier Found and not a colleague's", async () => {
    // The rival gave up on the second Item in the fixture. That is their record of their
    // own job, and the rule this screen answers to is the same for a refusal as for a
    // price: what reaches this reader is what this reader did.
    const before = reducedScreen(
      await loadTenderScreen(viewed.tenderId, mate.id, mateStore),
    );

    expect(before.items[1].yourNoSupplierFound).toBeNull();
    expect(everythingIn(before)).not.toContain("Rival rang four");

    const recorded = await recordNoSupplierFound(
      { tenderItemId: viewed.otherItemId, note: "None of mine stock it." },
      mateStore,
    );

    expect(recorded.ok).toBe(true);

    const after = reducedScreen(
      await loadTenderScreen(viewed.tenderId, mate.id, mateStore),
    );

    expect(after.items[1].yourNoSupplierFound?.userId).toBe(mate.id);
    expect(after.items[1].yourNoSupplierFound?.note).toBe("None of mine stock it.");
    expect(everythingIn(after)).not.toContain("Rival rang four");
  });

  it("gives a colleague on neither role the reduced screen and the enrol control", async () => {
    // Untouched by this change: they get the notice and the members to add themselves
    // with, exactly as today. What they do not get is the sheet, because the sheet is the
    // Owner's — not being an Assignee is not a way round that.
    const screen = reducedScreen(
      await loadTenderScreen(viewed.tenderId, bystander.id, bystanderStore),
    );

    expect(screen.tender?.id).toBe(viewed.tenderId);
    expect(screen.items).toHaveLength(2);
    expect(screen.items.flatMap((item) => item.yourQuotes)).toEqual([]);
    expect(screen.members.map((member) => member.id)).toContain(bystander.id);
    expect(everythingIn(screen)).not.toContain("Mate Trading");
  });

  it("gives an Org Admin nothing extra for being one", async () => {
    // `CONTEXT.md` is emphatic that the capability is not a rank, and ADR-0020 keeps it
    // that way: the tier is Owner-versus-everybody-else on one Tender.
    const screen = reducedScreen(
      await loadTenderScreen(viewed.tenderId, admin.id, adminStore),
    );

    expect(screen.items.flatMap((item) => item.yourQuotes)).toEqual([]);
    expect(everythingIn(screen)).not.toContain(String(priced.sellingPrice));
  });

  // The last two mutate the fixture, in the order they are written.

  it("gives an Owner who is also an Assignee everything", async () => {
    // Owner wins. Working a Tender you own must not cost you the screen for owning it.
    const added = await addAssignee({ tenderId: viewed.tenderId, userId: owner.id }, store);

    expect(added.ok).toBe(true);

    const screen = ownersScreen(
      await loadTenderScreen(viewed.tenderId, owner.id, store),
    );

    expect(screen.tender?.assignees.map((assignee) => assignee.id)).toContain(owner.id);
    expect(screen.sheet.items[0].landedCostPerUnit).toBe(priced.landedCost);
    expect(screen.sheet.items[0].quotes).toHaveLength(2);
  });

  it("still names what a non-Owner Assignee owes", async () => {
    // The band is per-viewer and was already; this is that it survived the split. The
    // rival has answered for both Items, so the Owner's colleague is the one with
    // anything left — the second Item, which they have now refused, and the first, which
    // they quoted. Which leaves nothing, and the rival owing nothing either.
    const theirs = reducedScreen(
      await loadTenderScreen(viewed.tenderId, rival.id, rivalStore),
    );

    expect(theirs.outstandingForYou).toEqual([]);

    const onlooker = reducedScreen(
      await loadTenderScreen(viewed.tenderId, bystander.id, bystanderStore),
    );

    expect(onlooker.outstandingForYou).toEqual([]);
  });
});

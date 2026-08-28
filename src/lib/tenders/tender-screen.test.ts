import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
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
import { createTender, getTender } from "@/lib/tenders/tenders";

import { loadTenderScreen } from "./tender-screen";

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

/** A Tender with two Items, so "unassigned" can be told from "placed on an Item". */
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

  const tender = await getTender(tenderId, store);

  itemId = tender!.items[0].id;
  otherItemId = tender!.items[1].id;
}

/**
 * One Reference Image on the Tender. Placed against `tenderItemId`, or left Unassigned
 * when that is null — which is the state every Reference Image starts in.
 */
async function aReferenceImage(
  tenderItemId: string | null,
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

  if (tenderItemId === null) return;

  const assigned = await assignReferenceImage(
    { imageId: recorded.imageIds[0], tenderItemId },
    store,
  );

  if (!assigned.ok) throw new Error(`could not place an image: ${assigned.reason}`);
}

let store: SessionCookieStore;
let outsiderStore: SessionCookieStore;

beforeAll(async () => {
  orgId = await createOrg(`Tender screen ${run}`);
  otherOrgId = await createOrg(`Tender screen outsiders ${run}`);

  await createMember(orgId, owner);
  await createMember(otherOrgId, outsider);

  store = await signedInAs(owner.email);
  outsiderStore = await signedInAs(outsider.email);

  await aTenderWithTwoItems(store);

  // One placed on each Item and one left Unassigned, so a loader that split them wrongly
  // would come back with three in the unassigned pile or none.
  await aReferenceImage(itemId, store);
  await aReferenceImage(otherItemId, store);
  await aReferenceImage(null, store);
});

afterAll(async () => {
  for (const org of [orgId, otherOrgId]) {
    await service.from("tenders").delete().eq("org_id", org);
    await service.from("suppliers").delete().eq("org_id", org);
  }

  if (objects.length > 0) {
    await service.storage.from(imagesBucket).remove(objects);
  }

  const memberIds = [owner.id, outsider.id].filter(Boolean);

  await service.from("users").delete().in("id", memberIds);

  for (const id of memberIds) {
    await service.auth.admin.deleteUser(id);
  }

  for (const org of [orgId, otherOrgId]) {
    await service.from("orgs").delete().eq("id", org);
  }
});

describe("loading the tender screen", () => {
  it("returns the Tender with everything the screen draws beside it", async () => {
    const screen = await loadTenderScreen(tenderId, store);

    expect(screen.tender?.id).toBe(tenderId);
    expect(screen.sheet.items).toHaveLength(2);
    expect(screen.members.map((member) => member.id)).toContain(owner.id);
    expect(screen.timezone).toBeTruthy();
    expect(screen.referenceImages).toHaveLength(3);
  });

  it("separates the Reference Images nobody has placed yet", async () => {
    const screen = await loadTenderScreen(tenderId, store);

    expect(screen.unassignedImages).toHaveLength(1);
    expect(screen.unassignedImages[0].tenderItemId).toBeNull();
    // The other two are still in the full list — split, not filtered out.
    expect(screen.referenceImages.filter((image) => image.tenderItemId !== null))
      .toHaveLength(2);
  });

  it("answers a Tender that does not exist with null, rather than throwing", async () => {
    // The batch runs all five reads against this id. Every one of them has to survive it,
    // or the page's `notFound()` never gets the chance to run.
    const screen = await loadTenderScreen(crypto.randomUUID(), store);

    expect(screen.tender).toBeNull();
    expect(screen.sheet.items).toEqual([]);
    expect(screen.referenceImages).toEqual([]);
    expect(screen.unassignedImages).toEqual([]);
  });

  it("answers another org's Tender the same way, and reads none of it", async () => {
    // RLS makes this identical to the case above, which is the point: the outsider learns
    // nothing about whether this id exists. The four reads that now run before anyone has
    // checked must come back empty rather than error.
    const screen = await loadTenderScreen(tenderId, outsiderStore);

    expect(screen.tender).toBeNull();
    expect(screen.sheet.items).toEqual([]);
    expect(screen.referenceImages).toEqual([]);
  });
});

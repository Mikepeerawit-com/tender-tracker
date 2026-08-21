import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";
import { createStorageClient } from "@/lib/supabase/storage-client";
import { imagesBucket, maxImageBytes, maxImagesAtOnce } from "@/lib/images/images";
import { onePixelJpeg } from "@/lib/images/one-pixel-jpeg";
import { createTender, getTender } from "@/lib/tenders/tenders";

import {
  assignReferenceImage,
  listReferenceImages,
  recordReferenceImages,
  removeReferenceImage,
  signReferenceImageUploads,
  type ReferenceImageUpload,
} from "./reference-images";

/**
 * Reference Images, through the session client and against the real local Storage.
 *
 * The shape being held to here is the one the ticket is about: the upload is
 * *per-Tender* and the assignment to an Item happens afterwards, because five pictures
 * arrive in one email and nobody sorts them in the mail client. So an Unassigned image
 * is a first-class row, not a half-finished one.
 *
 * Nothing is mocked. The signing step is the one place the app touches Storage's
 * authorisation, and it only answers correctly with the caller's real session behind it
 * — a stub would assert the argument list and nothing about whether the upload could
 * actually happen.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const owner = { id: "", email: `ref-owner-${run}@example.test` };
const outsider = { id: "", email: `ref-outsider-${run}@example.test` };

let orgId = "";
let otherOrgId = "";

/** The fixture Tender, its two Items, and a Tender belonging to the other org. */
let tenderId = "";
let itemIds: string[] = [];
let otherTenderId = "";

/** Every Tender any test made beyond the fixture, torn down however the test ended. */
const created: string[] = [];

/** Every object any test put in the bucket. Nothing cascades from a row into Storage. */
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

async function aTender(
  who: { id: string; email: string },
  items = 1,
): Promise<{ tenderId: string; itemIds: string[] }> {
  const store = await signedInAs(who.email);
  const result = await createTender(
    {
      clientName: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      dateReceived: "2026-08-01",
      internalQuoteDeadline: "2026-08-20",
      clientSubmissionDeadline: "2026-08-28",
      expectedDecisionDate: null,
      ownerUserId: who.id,
      notes: null,
      items: Array.from({ length: items }, (_unused, index) => ({
        productName: `Nitrile gloves ${index}`,
        description: null,
        quantity: 500,
        unit: "box of 50",
      })),
    },
    store,
  );

  if (!result.ok) throw new Error(`could not create a Tender: ${result.reason}`);

  const tender = await getTender(result.tenderId, store);

  return {
    tenderId: result.tenderId,
    itemIds: (tender?.items ?? []).map((item) => item.id),
  };
}

/** One image, described the way the browser describes it before it has uploaded it. */
function anImage(overrides: { contentType?: string; byteSize?: number } = {}) {
  return { contentType: "image/jpeg", byteSize: 240_000, ...overrides };
}

/**
 * Sign, then upload, exactly the way the uploader component does — the same client and
 * all, which holds no session at all. The signed token is the whole authorisation, and
 * that is what makes the route usable from a phone whose only credential is a cookie the
 * page never reads.
 */
async function uploaded(
  count: number,
  store: SessionCookieStore,
  against = tenderId,
): Promise<string[]> {
  const signed = await signReferenceImageUploads(
    {
      tenderId: against,
      images: Array.from({ length: count }, () => anImage()),
    },
    store,
  );

  if (!signed.ok) throw new Error(`could not sign an upload: ${signed.reason}`);

  const client = createStorageClient();

  for (const upload of signed.uploads as ReferenceImageUpload[]) {
    objects.push(upload.storagePath);

    const { error } = await client.storage
      .from(imagesBucket)
      .uploadToSignedUrl(upload.storagePath, upload.token, onePixelJpeg());

    if (error) throw error;
  }

  return signed.uploads.map((upload) => upload.storagePath);
}

beforeAll(async () => {
  orgId = await createOrg(`Reference images ${run}`);
  otherOrgId = await createOrg(`Reference images other ${run}`);

  await createMember(orgId, owner);
  await createMember(otherOrgId, outsider);

  ({ tenderId, itemIds } = await aTender(owner, 2));
  ({ tenderId: otherTenderId } = await aTender(outsider));
});

afterEach(async () => {
  // The fixture Tender outlives every test, so its images have to not: a test that
  // counted what it uploaded would otherwise count what the test before it did too.
  await service.from("reference_images").delete().eq("tender_id", tenderId);

  if (created.length === 0) return;

  await service.from("tenders").delete().in("id", created);
  created.length = 0;
});

afterAll(async () => {
  if (objects.length > 0) await service.storage.from(imagesBucket).remove(objects);

  await service.from("tenders").delete().in("id", [tenderId, otherTenderId]);

  const memberIds = [owner.id, outsider.id].filter((id) => id !== "");

  await service.from("users").delete().in("id", memberIds);

  for (const id of memberIds) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().in("id", [orgId, otherOrgId].filter(Boolean));
});

describe("signing an upload", () => {
  it("signs one upload per image, keyed by org and Tender", async () => {
    const store = await signedInAs(owner.email);

    const result = await signReferenceImageUploads(
      { tenderId, images: [anImage(), anImage()] },
      store,
    );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.uploads).toHaveLength(2);

    for (const upload of result.uploads) {
      objects.push(upload.storagePath);

      expect(upload.storagePath.startsWith(`${orgId}/tenders/${tenderId}/`)).toBe(true);
      expect(upload.token).toBeTruthy();
    }

    // Two images from one email are two objects, never one overwriting the other.
    expect(new Set(result.uploads.map((upload) => upload.storagePath)).size).toBe(2);
  });

  it("refuses an image over the 10 MB cap", async () => {
    const store = await signedInAs(owner.email);

    const result = await signReferenceImageUploads(
      { tenderId, images: [anImage({ byteSize: maxImageBytes + 1 })] },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses the whole batch when one image is over the cap", async () => {
    // Deliberately all-or-nothing. Five pictures are one act, and a batch that
    // half-succeeded would leave the user guessing which of the five is missing.
    const store = await signedInAs(owner.email);

    const result = await signReferenceImageUploads(
      { tenderId, images: [anImage(), anImage({ byteSize: maxImageBytes + 1 })] },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses anything that is not an image Storage will take", async () => {
    const store = await signedInAs(owner.email);

    const result = await signReferenceImageUploads(
      { tenderId, images: [anImage({ contentType: "application/pdf" })] },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "not_an_image" });
  });

  it("refuses more images than one act may carry", async () => {
    // A mis-tap can select a whole photo library. Signing is a round trip per image, so
    // the bound is on the server and not only in the picker.
    const store = await signedInAs(owner.email);

    const result = await signReferenceImageUploads(
      {
        tenderId,
        images: Array.from({ length: maxImagesAtOnce + 1 }, () => anImage()),
      },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "too_many" });
  });

  it("refuses an empty batch", async () => {
    const store = await signedInAs(owner.email);

    const result = await signReferenceImageUploads({ tenderId, images: [] }, store);

    expect(result).toEqual({ ok: false, reason: "no_images" });
  });

  it("will not sign an upload against another org's Tender", async () => {
    // RLS makes it invisible, and invisible is the same answer as deleted.
    const store = await signedInAs(owner.email);

    const result = await signReferenceImageUploads(
      { tenderId: otherTenderId, images: [anImage()] },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("will not sign an upload for nobody", async () => {
    const result = await signReferenceImageUploads(
      { tenderId, images: [anImage()] },
      memoryCookieStore(),
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("recording what was uploaded", () => {
  it("records every uploaded image against the Tender, unassigned", async () => {
    const store = await signedInAs(owner.email);
    const storagePaths = await uploaded(2, store);

    const result = await recordReferenceImages({ tenderId, storagePaths }, store);

    expect(result.ok).toBe(true);

    const images = await listReferenceImages(tenderId, store);

    expect(images).toHaveLength(2);
    expect(images.every((image) => image.tenderItemId === null)).toBe(true);
    expect(images.map((image) => image.uploadedByName)).toEqual([
      owner.email,
      owner.email,
    ]);
  });

  it("hands back a signed URL that actually fetches the image", async () => {
    const store = await signedInAs(owner.email);
    const storagePaths = await uploaded(1, store);

    await recordReferenceImages({ tenderId, storagePaths }, store);

    const [image] = await listReferenceImages(tenderId, store);
    const response = await fetch(image.url);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/");
  });

  it("refuses a path outside the Tender's own folder", async () => {
    // The storage policy already stops another org's folder. This is the check inside
    // one: without it a path from Tender A could be recorded as Tender B's image, and
    // the picture the client sent would sit against a Tender it never came with.
    const store = await signedInAs(owner.email);
    const second = await aTender(owner);

    created.push(second.tenderId);

    const storagePaths = await uploaded(1, store, second.tenderId);
    const result = await recordReferenceImages({ tenderId, storagePaths }, store);

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a path with no object behind it", async () => {
    // Nothing stops a caller posting a path it never uploaded to. A row recorded for an
    // absent object is a permanently broken image on the Tender.
    const store = await signedInAs(owner.email);
    const signed = await signReferenceImageUploads(
      { tenderId, images: [anImage()] },
      store,
    );

    if (!signed.ok) throw new Error(signed.reason);

    const result = await recordReferenceImages(
      { tenderId, storagePaths: [signed.uploads[0].storagePath] },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "not_uploaded" });
  });

  it("records nothing for nobody", async () => {
    const result = await recordReferenceImages(
      { tenderId, storagePaths: ["nowhere/at/all.jpg"] },
      memoryCookieStore(),
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("shows another org's member none of them", async () => {
    const store = await signedInAs(owner.email);

    await recordReferenceImages({ tenderId, storagePaths: await uploaded(1, store) }, store);

    expect(await listReferenceImages(tenderId, await signedInAs(outsider.email))).toEqual(
      [],
    );
  });
});

describe("assigning an image to an Item", () => {
  /** One recorded, unassigned image on the fixture Tender. */
  async function anImageOnTheTender(store: SessionCookieStore): Promise<string> {
    const result = await recordReferenceImages(
      { tenderId, storagePaths: await uploaded(1, store) },
      store,
    );

    if (!result.ok) throw new Error(`could not record an image: ${result.reason}`);

    return result.imageIds[0];
  }

  it("assigns an unassigned image to an Item on its own Tender", async () => {
    const store = await signedInAs(owner.email);
    const imageId = await anImageOnTheTender(store);

    const result = await assignReferenceImage(
      { imageId, tenderItemId: itemIds[1] },
      store,
    );

    expect(result).toEqual({ ok: true });

    const [image] = await listReferenceImages(tenderId, store);

    expect(image.tenderItemId).toBe(itemIds[1]);
  });

  it("moves an image from one Item to another", async () => {
    // Whoever assigns five pictures at once will put one of them on the wrong Item.
    const store = await signedInAs(owner.email);
    const imageId = await anImageOnTheTender(store);

    await assignReferenceImage({ imageId, tenderItemId: itemIds[0] }, store);
    await assignReferenceImage({ imageId, tenderItemId: itemIds[1] }, store);

    const [image] = await listReferenceImages(tenderId, store);

    expect(image.tenderItemId).toBe(itemIds[1]);
  });

  it("takes an image back off an Item", async () => {
    const store = await signedInAs(owner.email);
    const imageId = await anImageOnTheTender(store);

    await assignReferenceImage({ imageId, tenderItemId: itemIds[0] }, store);

    const result = await assignReferenceImage({ imageId, tenderItemId: null }, store);

    expect(result).toEqual({ ok: true });

    const [image] = await listReferenceImages(tenderId, store);

    expect(image.tenderItemId).toBeNull();
  });

  it("refuses an Item belonging to another Tender", async () => {
    // The picture would sit under an Item on a Tender it was never sent about, and the
    // Tender it *was* sent about would stop showing it. Both foreign keys point at rows
    // the caller can legitimately see, so nothing but this check notices.
    const store = await signedInAs(owner.email);
    const imageId = await anImageOnTheTender(store);
    const second = await aTender(owner);

    created.push(second.tenderId);

    const result = await assignReferenceImage(
      { imageId, tenderItemId: second.itemIds[0] },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses an image the caller cannot see", async () => {
    const store = await signedInAs(owner.email);
    const imageId = await anImageOnTheTender(store);

    const result = await assignReferenceImage(
      { imageId, tenderItemId: null },
      await signedInAs(outsider.email),
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("assigns nothing for nobody", async () => {
    const result = await assignReferenceImage(
      { imageId: crypto.randomUUID(), tenderItemId: null },
      memoryCookieStore(),
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("removing an image", () => {
  it("takes the image off the Tender and the object out of the bucket", async () => {
    const store = await signedInAs(owner.email);
    const [storagePath] = await uploaded(1, store);
    const recorded = await recordReferenceImages({ tenderId, storagePaths: [storagePath] }, store);

    if (!recorded.ok) throw new Error(recorded.reason);

    const result = await removeReferenceImage(recorded.imageIds[0], store);

    expect(result).toEqual({ ok: true });
    expect(await listReferenceImages(tenderId, store)).toEqual([]);

    // The bytes go too. There is no retention rule in v1, so nothing else would ever
    // come back for them.
    const { data } = await service.storage
      .from(imagesBucket)
      .list(`${orgId}/tenders/${tenderId}`, { limit: 1000 });

    expect((data ?? []).map((object) => object.name)).not.toContain(
      storagePath.split("/").pop(),
    );
  });

  it("refuses an image the caller cannot see", async () => {
    const store = await signedInAs(owner.email);
    const recorded = await recordReferenceImages(
      { tenderId, storagePaths: await uploaded(1, store) },
      store,
    );

    if (!recorded.ok) throw new Error(recorded.reason);

    const result = await removeReferenceImage(
      recorded.imageIds[0],
      await signedInAs(outsider.email),
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(await listReferenceImages(tenderId, store)).toHaveLength(1);
  });

  it("removes nothing for nobody", async () => {
    const result = await removeReferenceImage(crypto.randomUUID(), memoryCookieStore());

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("an image whose object has gone", () => {
  it("is still listed, with no URL, rather than vanishing", async () => {
    // The alternative was dropping the row from the list. An image that disappears off
    // the Tender leaving nothing behind is the one state nobody can act on — you cannot
    // even remove it. Listed with an empty URL, it can be seen and dealt with.
    const store = await signedInAs(owner.email);
    const [storagePath] = await uploaded(1, store);

    await recordReferenceImages({ tenderId, storagePaths: [storagePath] }, store);
    await service.storage.from(imagesBucket).remove([storagePath]);

    const images = await listReferenceImages(tenderId, store);

    expect(images).toHaveLength(1);
    expect(images[0].url).toBe("");
  });
});

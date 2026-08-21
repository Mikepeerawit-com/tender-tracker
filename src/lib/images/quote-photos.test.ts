import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { signIn } from "@/lib/auth/session";
import { imagesBucket } from "@/lib/images/images";
import { onePixelJpeg } from "@/lib/images/one-pixel-jpeg";
import { createQuote } from "@/lib/quotes/quotes";
import { createServiceClient } from "@/lib/supabase/service-client";
import {
  memoryCookieStore,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";
import { createStorageClient } from "@/lib/supabase/storage-client";
import { addAssignee, createTender, getTender } from "@/lib/tenders/tenders";

import {
  listQuotePhotos,
  listQuotePhotosByQuote,
  recordQuotePhotos,
  removeQuotePhoto,
  signQuotePhotoUploads,
} from "./quote-photos";

/**
 * Quote Photos, through the session client and against the real local Storage.
 *
 * The image path itself was proved by the Reference Image suite and is not re-proved
 * here: same bucket, same policy, same signed-URL round trip. What is new is that the
 * folder is keyed by a *Quote* — so the checks worth making are that a photo cannot be
 * filed under a Quote that is not the caller's org's, that the folder really is
 * `{org_id}/quotes/{quote_id}`, and that the two listings agree with each other.
 *
 * The Frankfurter boundary is stubbed nowhere here: every fixture Quote is in THB, which
 * is not converted and never touches a rate service.
 */

const password = "correct-horse-battery-staple";
const run = crypto.randomUUID().slice(0, 8);

const service = createServiceClient();

const assignee = { id: "", email: `photo-assignee-${run}@example.test` };
const outsider = { id: "", email: `photo-outsider-${run}@example.test` };

let orgId = "";
let otherOrgId = "";
let quoteId = "";
let otherQuoteId = "";

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

/** A Tender with one Item, one Assignee, and one THB Quote already on it. */
async function aQuotedItem(
  who: { id: string; email: string },
): Promise<{ tenderId: string; quoteId: string }> {
  const store = await signedInAs(who.email);
  const tender = await createTender(
    {
      clientName: "Bangkok General Hospital",
      title: "Surgical consumables Q3",
      dateReceived: "2026-08-01",
      internalQuoteDeadline: "2026-08-20",
      clientSubmissionDeadline: "2026-08-28",
      expectedDecisionDate: null,
      ownerUserId: who.id,
      notes: null,
      items: [
        {
          productName: "Nitrile gloves, powder-free",
          description: null,
          quantity: 500,
          unit: "box of 50",
        },
      ],
    },
    store,
  );

  if (!tender.ok) throw new Error(`could not create a Tender: ${tender.reason}`);

  await addAssignee({ tenderId: tender.tenderId, userId: who.id }, store);

  const full = await getTender(tender.tenderId, store);
  const quote = await createQuote(
    {
      tenderItemId: full!.items[0].id,
      supplierName: `Ace Medical ${run}`,
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

  return { tenderId: tender.tenderId, quoteId: quote.quoteId };
}

/**
 * Sign, then upload, exactly the way the uploader does — through the session-less browser
 * client, where the signed token is the whole authorisation.
 */
async function uploaded(
  count: number,
  store: SessionCookieStore,
  against = quoteId,
): Promise<string[]> {
  const signed = await signQuotePhotoUploads(
    {
      quoteId: against,
      images: Array.from({ length: count }, () => ({
        contentType: "image/jpeg",
        byteSize: 240_000,
      })),
    },
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

  return signed.uploads.map((upload) => upload.storagePath);
}

beforeAll(async () => {
  orgId = await createOrg(`Quote photos ${run}`);
  otherOrgId = await createOrg(`Quote photos other ${run}`);

  await createMember(orgId, assignee);
  await createMember(otherOrgId, outsider);

  ({ quoteId } = await aQuotedItem(assignee));
  ({ quoteId: otherQuoteId } = await aQuotedItem(outsider));
});

afterEach(async () => {
  await service.from("quote_photos").delete().eq("quote_id", quoteId);
});

afterAll(async () => {
  if (objects.length > 0) await service.storage.from(imagesBucket).remove(objects);

  await service.from("tenders").delete().in("org_id", [orgId, otherOrgId]);
  await service.from("suppliers").delete().in("org_id", [orgId, otherOrgId]);

  const memberIds = [assignee.id, outsider.id].filter(Boolean);

  await service.from("users").delete().in("id", memberIds);

  for (const id of memberIds) {
    await service.auth.admin.deleteUser(id);
  }

  await service.from("orgs").delete().in("id", [orgId, otherOrgId]);
});

describe("signing an upload", () => {
  it("keys the folder by org and Quote", async () => {
    const store = await signedInAs(assignee.email);

    const result = await signQuotePhotoUploads(
      { quoteId, images: [{ contentType: "image/jpeg", byteSize: 100_000 }] },
      store,
    );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    objects.push(result.uploads[0].storagePath);

    // The org id leads because it is the segment the storage policy matches on; the
    // Quote id is what keeps one supplier's photos apart from another's inside it.
    expect(result.uploads[0].storagePath).toMatch(
      new RegExp(`^${orgId}/quotes/${quoteId}/[0-9a-f-]+\\.jpg$`),
    );
  });

  it("gives another org's Quote the same answer as a deleted one", async () => {
    const store = await signedInAs(assignee.email);

    const result = await signQuotePhotoUploads(
      {
        quoteId: otherQuoteId,
        images: [{ contentType: "image/jpeg", byteSize: 100_000 }],
      },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a file that is not a picture this app can store", async () => {
    const store = await signedInAs(assignee.email);

    const result = await signQuotePhotoUploads(
      { quoteId, images: [{ contentType: "application/pdf", byteSize: 100 }] },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "not_an_image" });
  });

  it("refuses a signed-out caller", async () => {
    const result = await signQuotePhotoUploads(
      { quoteId, images: [{ contentType: "image/jpeg", byteSize: 100 }] },
      memoryCookieStore(),
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("recording what landed", () => {
  it("keeps the photos that uploaded, with a signed URL each", async () => {
    const store = await signedInAs(assignee.email);
    const paths = await uploaded(2, store);

    const recorded = await recordQuotePhotos({ quoteId, storagePaths: paths }, store);

    expect(recorded.ok).toBe(true);

    const photos = await listQuotePhotos(quoteId, store);

    expect(photos).toHaveLength(2);

    for (const photo of photos) {
      expect(photo.url).toContain("/object/sign/");
      expect(photo.uploadedByName).toBe(assignee.email);
    }
  });

  it("refuses a path that is not this Quote's folder", async () => {
    const store = await signedInAs(assignee.email);
    const paths = await uploaded(1, store);

    // The app is not on the upload path, so what it is told is hearsay until checked.
    // Without this, one Quote's photos could be filed under another.
    const result = await recordQuotePhotos(
      { quoteId: otherQuoteId, storagePaths: paths },
      store,
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a path nothing was ever uploaded to", async () => {
    const store = await signedInAs(assignee.email);

    const result = await recordQuotePhotos(
      {
        quoteId,
        storagePaths: [`${orgId}/quotes/${quoteId}/${crypto.randomUUID()}.jpg`],
      },
      store,
    );

    // A row naming an object that was never uploaded renders as a broken image for good.
    expect(result).toEqual({ ok: false, reason: "not_uploaded" });
  });
});

describe("reading them back", () => {
  it("groups a whole Item's photos by Quote in one pass", async () => {
    const store = await signedInAs(assignee.email);

    await recordQuotePhotos({ quoteId, storagePaths: await uploaded(2, store) }, store);

    const byQuote = await listQuotePhotosByQuote([quoteId, otherQuoteId], store);

    expect(byQuote.get(quoteId)).toHaveLength(2);
    // RLS, not a filter: another org's Quote has no photos as far as this caller is
    // concerned, which is the same answer as a Quote with none.
    expect(byQuote.get(otherQuoteId)).toBeUndefined();
  });

  it("asks for nothing when there are no Quotes to ask about", async () => {
    const store = await signedInAs(assignee.email);

    expect((await listQuotePhotosByQuote([], store)).size).toBe(0);
  });

  it("shows another org nothing", async () => {
    const mine = await signedInAs(assignee.email);
    const theirs = await signedInAs(outsider.email);

    await recordQuotePhotos({ quoteId, storagePaths: await uploaded(1, mine) }, mine);

    expect(await listQuotePhotos(quoteId, theirs)).toEqual([]);
  });
});

describe("taking one off", () => {
  it("removes the row and the bytes", async () => {
    const store = await signedInAs(assignee.email);
    const [path] = await uploaded(1, store);

    await recordQuotePhotos({ quoteId, storagePaths: [path] }, store);

    const [photo] = await listQuotePhotos(quoteId, store);

    expect((await removeQuotePhoto(photo.id, store)).ok).toBe(true);
    expect(await listQuotePhotos(quoteId, store)).toEqual([]);

    const { data } = await service.storage
      .from(imagesBucket)
      .list(`${orgId}/quotes/${quoteId}`, { limit: 1000 });

    expect((data ?? []).map((object) => object.name)).not.toContain(
      path.split("/").pop(),
    );
  });

  it("refuses across the org boundary", async () => {
    const mine = await signedInAs(assignee.email);
    const theirs = await signedInAs(outsider.email);

    await recordQuotePhotos({ quoteId, storagePaths: await uploaded(1, mine) }, mine);

    const [photo] = await listQuotePhotos(quoteId, mine);

    expect(await removeQuotePhoto(photo.id, theirs)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await listQuotePhotos(quoteId, mine)).toHaveLength(1);
  });
});

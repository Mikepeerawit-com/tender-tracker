import "server-only";

import { currentUser } from "@/lib/auth/session";
import {
  type ImageProblem,
  type ImageResult,
  type PendingImage,
  type StoredImageUpload,
} from "@/lib/images/images";
import {
  confirmUploaded,
  pendingProblem,
  removeObject,
  signUploads,
  signedReadUrls,
} from "@/lib/images/stored-images";
import {
  createSessionClient,
  type SessionCookieStore,
} from "@/lib/supabase/session-client";

/**
 * Reference Images: the pictures the *client* sent with their Tender.
 *
 * The upload is per-Tender and the assignment to an Item happens afterwards, because
 * that is how the work arrives — one email, five pictures, and no indication which of
 * the Tender's Items each of them is about. `reference_images.tender_item_id` is
 * nullable for exactly this reason, so an unassigned image is a finished row rather
 * than a half-written one.
 *
 * The path underneath — one private bucket, `{org_id}/tenders/{tender_id}/{uuid}.{ext}`,
 * the upload going browser-to-Storage through `createSignedUploadUrl()`, and every read a
 * signed URL — lives in `./stored-images.ts` and is shared with Quote Photos. Nothing
 * streams a file through this app: a phone on mobile data inside the WeCom webview
 * uploads to Storage directly, and the server only ever hands out a token and records
 * what came back.
 *
 * Everything reads and writes through the *session* client, so RLS is what keeps one
 * org out of another's images, on the `reference_images` rows and on the Storage objects
 * alike. See supabase/migrations/20260821010000_one_private_bucket_for_every_image.sql.
 */

/**
 * The refusal union, now shared with Quote Photos — the reasons are the same sentences.
 * Re-exported under the old names because this is the vocabulary the Reference Image
 * screens speak, and the wording they render lives at `images.error.<reason>`.
 */
export { imageProblems as referenceImageProblems } from "@/lib/images/images";
export type { PendingImage };
export type ReferenceImageProblem = ImageProblem;
export type ReferenceImageResult<T = Record<never, never>> = ImageResult<T>;
export type ReferenceImageUpload = StoredImageUpload;

/**
 * Sign an upload for each image, all or nothing.
 *
 * Five pictures are one act, so a single image over the cap refuses the lot and says
 * why. The token is minted through the caller's own session, so the storage policy is
 * what decides whether the path is theirs to write.
 */
export async function signReferenceImageUploads(
  { tenderId, images }: { tenderId: string; images: PendingImage[] },
  store: SessionCookieStore,
): Promise<ReferenceImageResult<{ uploads: ReferenceImageUpload[] }>> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  // Before the Tender is looked up, so a batch that was never going to be accepted costs
  // no round trip and says what is wrong with the pictures rather than about the Tender.
  const problem = pendingProblem(images);

  if (problem) return { ok: false, reason: problem };

  const supabase = createSessionClient(store);

  // RLS turns another org's Tender into no row, which is the same answer as one deleted
  // while the picker was open — and the same answer is the right one to give.
  const { data: tender } = await supabase
    .from("tenders")
    .select("id")
    .eq("id", tenderId)
    .maybeSingle();

  if (!tender) return { ok: false, reason: "not_found" };

  return signUploads(
    { orgId: caller.orgId, owner: "tenders", entityId: tenderId, images },
    supabase,
  );
}

/** One Reference Image as a screen needs it: a signed URL, and where it belongs. */
export type ReferenceImage = {
  id: string;
  /** Null while the image is Unassigned, which is the state it arrives in. */
  tenderItemId: string | null;
  /**
   * A signed URL, and therefore perishable: never stored, never cached past the render.
   *
   * Empty when Storage would not sign one, which means the object behind the row has gone
   * missing. The row is still returned — an image that vanishes off the Tender with no
   * trace is the one state nobody can act on, whereas one that says it cannot be loaded
   * can at least be removed.
   */
  url: string;
  uploadedAt: string;
  uploadedByName: string;
};

/**
 * Record the objects that made it, after the browser has uploaded them.
 *
 * Split from signing because the upload happens between the two and this app is not on
 * that path — it hands out tokens and then hears what came back. Both halves of that
 * hearsay are checked in `confirmUploaded`.
 */
export async function recordReferenceImages(
  { tenderId, storagePaths }: { tenderId: string; storagePaths: string[] },
  store: SessionCookieStore,
): Promise<ReferenceImageResult<{ imageIds: string[] }>> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const problem = await confirmUploaded(
    { orgId: caller.orgId, owner: "tenders", entityId: tenderId, storagePaths },
    supabase,
  );

  if (problem) return { ok: false, reason: problem };

  const { data, error } = await supabase
    .from("reference_images")
    .insert(
      storagePaths.map((storagePath) => ({
        org_id: caller.orgId,
        tender_id: tenderId,
        storage_path: storagePath,
        uploaded_by_user_id: caller.id,
      })),
    )
    .select("id");

  if (error !== null || !data) return { ok: false, reason: "failed" };

  return { ok: true, imageIds: data.map((row) => row.id) };
}

/**
 * Say which Item a picture is of — or take it back off, with `null`.
 *
 * The Item has to be on the *same Tender* as the image, and nothing in the schema says
 * so: `reference_images` carries both a `tender_id` and a `tender_item_id`, and each
 * foreign key is satisfied on its own. An Item from another Tender would leave a client's
 * picture filed under a Tender it was never sent with, and quietly missing from the one
 * it was.
 */
export async function assignReferenceImage(
  { imageId, tenderItemId }: { imageId: string; tenderItemId: string | null },
  store: SessionCookieStore,
): Promise<ReferenceImageResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const { data: image } = await supabase
    .from("reference_images")
    .select("id, tender_id")
    .eq("id", imageId)
    .maybeSingle();

  if (!image) return { ok: false, reason: "not_found" };

  if (tenderItemId !== null) {
    const { data: item } = await supabase
      .from("tender_items")
      .select("id")
      .eq("id", tenderItemId)
      .eq("tender_id", image.tender_id)
      .maybeSingle();

    // No such Item *on this Tender* — which is what the caller asked for, and is the
    // same answer whether the Item is gone or belongs to another Tender altogether.
    if (!item) return { ok: false, reason: "not_found" };
  }

  const { data, error } = await supabase
    .from("reference_images")
    .update({ tender_item_id: tenderItemId })
    .eq("id", imageId)
    .select("id");

  if (error !== null) return { ok: false, reason: "failed" };

  // Still checked after the write: the read above and this update are two statements,
  // and the image can go between them.
  return data.length === 1 ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * Every Reference Image on a Tender, Unassigned ones included, each with a signed read
 * URL.
 *
 * Unassigned is not a separate query, because it is not a lesser state: it is the one
 * every Reference Image arrives in, and a screen that listed only the placed ones would
 * hide the five that just came in behind the ones already dealt with.
 */
export async function listReferenceImages(
  tenderId: string,
  store: SessionCookieStore,
): Promise<ReferenceImage[]> {
  const supabase = createSessionClient(store);
  const { data } = await supabase
    .from("reference_images")
    .select(
      "id, tender_item_id, storage_path, uploaded_at, " +
        "uploader:users!reference_images_uploaded_by_user_id_fkey(name)",
    )
    .eq("tender_id", tenderId)
    // `uploaded_at` alone is not an order. A batch is one insert statement and `now()`
    // is transaction-stable, so all five images carry the same timestamp to the
    // microsecond and the tiebreak falls through to heap order — which moves when a row
    // is updated, i.e. every time somebody assigns one to an Item. `id` is random, so
    // this is stable rather than meaningful, and stable is what a list with a picker
    // beside every row actually needs.
    .order("uploaded_at")
    .order("id")
    .overrideTypes<ReferenceImageDbRow[], { merge: false }>();

  const rows = data ?? [];
  const urls = await signedReadUrls(
    rows.map((row) => row.storage_path),
    supabase,
  );

  return rows.map((row) => ({
    id: row.id,
    tenderItemId: row.tender_item_id,
    // "" means Storage would not sign it — see the field's own note. Not filtered out.
    url: urls.get(row.storage_path) ?? "",
    uploadedAt: row.uploaded_at,
    // An uploader with no name means the embed came back empty, which RLS cannot
    // produce for an image the caller can already see.
    uploadedByName: row.uploader?.name ?? "",
  }));
}

/**
 * Take a Reference Image off its Tender, bytes and all. The row goes first and the
 * object second — `removeObject` carries the argument for that order.
 */
export async function removeReferenceImage(
  imageId: string,
  store: SessionCookieStore,
): Promise<ReferenceImageResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const { data: image } = await supabase
    .from("reference_images")
    .select("id, storage_path")
    .eq("id", imageId)
    .maybeSingle();

  if (!image) return { ok: false, reason: "not_found" };

  const { data, error } = await supabase
    .from("reference_images")
    .delete()
    .eq("id", imageId)
    .select("id");

  if (error !== null) return { ok: false, reason: "failed" };
  if (data.length !== 1) return { ok: false, reason: "not_found" };

  await removeObject(image.storage_path, supabase);

  return { ok: true };
}

/**
 * The row shape the read comes back as, written out rather than inferred: this project
 * has no generated `Database` types, so PostgREST reports a to-one embed as an array
 * and `overrideTypes` is where the two are reconciled.
 */
type ReferenceImageDbRow = {
  id: string;
  tender_item_id: string | null;
  storage_path: string;
  uploaded_at: string;
  uploader: { name: string } | null;
};

import "server-only";

import { currentUser } from "@/lib/auth/session";
import {
  imageContentTypes,
  imagesBucket,
  isStorableImage,
  maxImageBytes,
  maxImagesAtOnce,
} from "@/lib/images/images";
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
 * The whole image path lands here once and Quote Photos reuse it: one private bucket,
 * paths keyed by org and entity id, the upload going browser-to-Storage through
 * `createSignedUploadUrl()`, and every read a signed URL. Nothing streams a file
 * through this app — a phone on mobile data inside the WeCom webview uploads to Storage
 * directly, and the server only ever hands out a token and records what came back.
 *
 * Everything reads and writes through the *session* client, so RLS is what keeps one
 * org out of another's images, on the `reference_images` rows and on the Storage objects
 * alike. See supabase/migrations/20260821010000_one_private_bucket_for_every_image.sql.
 */

/** How long a signed read URL lives. Long enough to open a lightbox, and no longer. */
const readUrlSeconds = 60 * 60;

/**
 * Every way a write here can be refused, as a list rather than a bare union, for the
 * same reason `tenderProblems` is one: the wording lives in the message files, and a
 * reason with none renders to the user as its own key. `messages.test.ts` walks this to
 * hold both locales to it.
 */
export const referenceImageProblems = [
  "forbidden",
  "not_found",
  "no_images",
  "too_many",
  "too_large",
  "not_an_image",
  "not_uploaded",
  "failed",
] as const;

export type ReferenceImageProblem = (typeof referenceImageProblems)[number];

export type ReferenceImageResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; reason: ReferenceImageProblem };

/** One image as the browser knows it, before it has uploaded anything. */
export type PendingImage = { contentType: string; byteSize: number };

/** One signed upload: where the object goes, and the token that lets it. */
export type ReferenceImageUpload = { storagePath: string; token: string };

/**
 * Sign an upload for each image, all or nothing.
 *
 * Five pictures are one act. A batch that half-succeeded would leave the user counting
 * thumbnails to work out which of the five never made it, so a single image over the cap
 * refuses the lot and says why — and because compression runs first, an image that is
 * still over 10 MB afterwards is a genuinely unusual file rather than a phone photo.
 *
 * The token is minted through the caller's own session, so the storage policy is what
 * decides whether the path is theirs to write. Handing back a token rather than
 * accepting bytes is the point: this is the route measured working inside the WeCom
 * webview, and it is the only one this project uses.
 */
export async function signReferenceImageUploads(
  { tenderId, images }: { tenderId: string; images: PendingImage[] },
  store: SessionCookieStore,
): Promise<ReferenceImageResult<{ uploads: ReferenceImageUpload[] }>> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  if (images.length === 0) return { ok: false, reason: "no_images" };
  if (images.length > maxImagesAtOnce) return { ok: false, reason: "too_many" };

  for (const image of images) {
    if (image.byteSize > maxImageBytes) return { ok: false, reason: "too_large" };
    if (!isStorableImage(image.contentType)) {
      return { ok: false, reason: "not_an_image" };
    }
  }

  const supabase = createSessionClient(store);

  // RLS turns another org's Tender into no row, which is the same answer as one deleted
  // while the picker was open — and the same answer is the right one to give.
  const { data: tender } = await supabase
    .from("tenders")
    .select("id")
    .eq("id", tenderId)
    .maybeSingle();

  if (!tender) return { ok: false, reason: "not_found" };

  const uploads: ReferenceImageUpload[] = [];

  for (const image of images) {
    const path = objectPath(caller.orgId, tenderId, image.contentType);
    const { data, error } = await supabase.storage
      .from(imagesBucket)
      .createSignedUploadUrl(path);

    if (error !== null || !data) return { ok: false, reason: "failed" };

    uploads.push({ storagePath: data.path, token: data.token });
  }

  return { ok: true, uploads };
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
 * hearsay are checked: the path has to be one this Tender's folder could have produced,
 * and the object has to actually be there. Without the first, a caller could file
 * Tender A's pictures under Tender B; without the second, a row could name an object
 * that was never uploaded, which renders as a broken image for good.
 */
export async function recordReferenceImages(
  { tenderId, storagePaths }: { tenderId: string; storagePaths: string[] },
  store: SessionCookieStore,
): Promise<ReferenceImageResult<{ imageIds: string[] }>> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  if (storagePaths.length === 0) return { ok: false, reason: "no_images" };

  const folder = tenderFolder(caller.orgId, tenderId);
  const prefix = `${folder}/`;
  const names = storagePaths.map((path) => path.slice(prefix.length));

  if (
    !storagePaths.every((path, index) => path.startsWith(prefix) && !names[index].includes("/"))
  ) {
    // The path is not this Tender's, so as far as this Tender is concerned there is
    // nothing there — the same answer RLS gives for another org's folder.
    return { ok: false, reason: "not_found" };
  }

  const supabase = createSessionClient(store);

  // One listing rather than one existence check per path: five images off one email is
  // the normal batch, and a phone on mobile data pays for every round trip.
  const { data: present, error: listError } = await supabase.storage
    .from(imagesBucket)
    .list(folder, { limit: 1000 });

  if (listError !== null) return { ok: false, reason: "failed" };

  const uploaded = new Set((present ?? []).map((object) => object.name));

  if (!names.every((name) => uploaded.has(name))) {
    return { ok: false, reason: "not_uploaded" };
  }

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

  if (rows.length === 0) return [];

  // One call for the whole page. Signing is a round trip per URL otherwise, and the
  // Tender screen renders every image on the Tender at once.
  const { data: signed } = await supabase.storage
    .from(imagesBucket)
    .createSignedUrls(
      rows.map((row) => row.storage_path),
      readUrlSeconds,
    );

  const urls = new Map(
    (signed ?? [])
      .filter((entry) => entry.signedUrl)
      .map((entry) => [entry.path, entry.signedUrl] as const),
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
 * Take a Reference Image off its Tender, bytes and all.
 *
 * The row goes first and the object second, and the order is the honest one: the row is
 * what the Tender shows, so deleting it is what the user asked for. If the object
 * removal then fails, the result is a few orphaned bytes nothing can reach — against the
 * other order, where a failed row delete leaves a permanently broken image on the
 * screen. There is deliberately no retention rule in v1, so nothing sweeps up after
 * either way.
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

  await supabase.storage.from(imagesBucket).remove([image.storage_path]);

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

/**
 * The one folder a Tender's Reference Images may live in: `{org_id}/tenders/{tender_id}`.
 *
 * Written once and used by all three of the places that need it — minting a path, listing
 * what has been uploaded, and deciding whether a path handed back is this Tender's. The
 * shape is the boundary (the storage policy matches on the leading segment), so three
 * hand-rolled template strings would be three chances to make it not one.
 */
function tenderFolder(orgId: string, tenderId: string): string {
  return `${orgId}/tenders/${tenderId}`;
}

/**
 * A new object in that folder.
 *
 * The uuid is the file name, not the one the phone gave it: two pictures off the same
 * camera are routinely both `IMG_0042.HEIC`, and a path collision would have the second
 * upload refused or — worse, with upsert — silently replace the first.
 */
function objectPath(orgId: string, tenderId: string, contentType: string): string {
  const extension = imageContentTypes.get(contentType);

  return `${tenderFolder(orgId, tenderId)}/${crypto.randomUUID()}.${extension}`;
}

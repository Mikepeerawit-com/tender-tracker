import "server-only";

import { currentUser } from "@/lib/auth/session";
import type {
  ImageResult,
  PendingImage,
  StoredImageUpload,
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
 * Quote Photos: the pictures the *supplier* sent, showing what they can actually
 * provide.
 *
 * Load-bearing rather than decorative. On an Alternative they are often the only way to
 * judge how far the substitute really is from what the client asked for — which is the
 * judgement the whole comparison view exists to support, and one no amount of typed
 * description substitutes for.
 *
 * They point the opposite way to a Reference Image and attach to a different thing: a
 * Reference Image arrives per-Tender and is placed on an Item afterwards, because five
 * of them come in one email with nothing saying which is which. A Quote Photo has no
 * such ambiguity — it was taken of the thing being priced, on the call it was priced on
 * — so it attaches straight to the Quote and is never Unassigned.
 *
 * Everything underneath is the path built for #25 and reused unchanged: one private
 * bucket, `{org_id}/quotes/{quote_id}/{uuid}.{ext}`, browser-to-Storage through
 * `createSignedUploadUrl()`, signed URLs for reads, no generated derivatives.
 */

export type QuotePhotoUpload = StoredImageUpload;

/** One Quote Photo as a screen needs it. */
export type QuotePhoto = {
  id: string;
  /** A signed URL, perishable, and empty when the object behind the row has gone. */
  url: string;
  uploadedAt: string;
  uploadedByName: string;
};

/**
 * Sign an upload for each photo against a Quote that already exists.
 *
 * The Quote first, the photos second, and it cannot be the other way round: the path is
 * keyed by the Quote's id, so there is nothing to key against until the price is
 * recorded. That ordering is also the safer one — a call that ends with the price
 * written down and the photos missing is recoverable, and one that ends with photos and
 * no price is not.
 */
export async function signQuotePhotoUploads(
  { quoteId, images }: { quoteId: string; images: PendingImage[] },
  store: SessionCookieStore,
): Promise<ImageResult<{ uploads: QuotePhotoUpload[] }>> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const problem = pendingProblem(images);

  if (problem) return { ok: false, reason: problem };

  const supabase = createSessionClient(store);

  // RLS turns another org's Quote into no row, which is the same answer as one deleted
  // while the camera was open.
  const { data: quote } = await supabase
    .from("quotes")
    .select("id")
    .eq("id", quoteId)
    .maybeSingle();

  if (!quote) return { ok: false, reason: "not_found" };

  return signUploads(
    { orgId: caller.orgId, owner: "quotes", entityId: quoteId, images },
    supabase,
  );
}

/**
 * Record the objects that made it, after the browser has uploaded them.
 *
 * `storagePaths` is the subset that uploaded, not the batch that was signed: a phone
 * that lost its signal after the second of three photos should keep the two.
 */
export async function recordQuotePhotos(
  { quoteId, storagePaths }: { quoteId: string; storagePaths: string[] },
  store: SessionCookieStore,
): Promise<ImageResult<{ photoIds: string[] }>> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const problem = await confirmUploaded(
    { orgId: caller.orgId, owner: "quotes", entityId: quoteId, storagePaths },
    supabase,
  );

  if (problem) return { ok: false, reason: problem };

  const { data, error } = await supabase
    .from("quote_photos")
    .insert(
      storagePaths.map((storagePath) => ({
        org_id: caller.orgId,
        quote_id: quoteId,
        storage_path: storagePath,
        uploaded_by_user_id: caller.id,
      })),
    )
    .select("id");

  if (error !== null || !data) return { ok: false, reason: "failed" };

  return { ok: true, photoIds: data.map((row) => row.id) };
}

/**
 * Every photo on one Quote, each with a signed read URL.
 *
 * `uploaded_at` then `id`, for the reason the Reference Image listing gives: a batch is
 * one insert statement and `now()` is transaction-stable, so every photo in it carries
 * the same timestamp to the microsecond and the tiebreak has to be something that does
 * not move.
 */
export async function listQuotePhotos(
  quoteId: string,
  store: SessionCookieStore,
): Promise<QuotePhoto[]> {
  return photosOf({ column: "quote_id", value: quoteId }, store);
}

/**
 * Every photo on every Quote for one Tender Item, keyed by Quote.
 *
 * One query and one signing call for the whole Item, rather than one of each per Quote.
 * The comparison view renders a count badge against every Quote on the Item at once, and
 * eight competing Quotes is what compete-not-divide makes normal.
 */
export async function listQuotePhotosByQuote(
  quoteIds: string[],
  store: SessionCookieStore,
): Promise<Map<string, QuotePhoto[]>> {
  const byQuote = new Map<string, QuotePhoto[]>();

  if (quoteIds.length === 0) return byQuote;

  for (const photo of await photosOf({ column: "quote_id", value: quoteIds }, store)) {
    byQuote.set(photo.quoteId, [...(byQuote.get(photo.quoteId) ?? []), photo]);
  }

  return byQuote;
}

/**
 * Take a photo off its Quote, bytes and all.
 *
 * A supplier photo is the one attachment routinely taken with the wrong thing in frame,
 * on a phone, in a hurry — so it has to be removable. The row goes first and the object
 * second; `removeObject` carries the argument for that order.
 */
export async function removeQuotePhoto(
  photoId: string,
  store: SessionCookieStore,
): Promise<ImageResult> {
  const caller = await currentUser(store);

  if (!caller) return { ok: false, reason: "forbidden" };

  const supabase = createSessionClient(store);
  const { data: photo } = await supabase
    .from("quote_photos")
    .select("id, storage_path")
    .eq("id", photoId)
    .maybeSingle();

  if (!photo) return { ok: false, reason: "not_found" };

  const { data, error } = await supabase
    .from("quote_photos")
    .delete()
    .eq("id", photoId)
    .select("id");

  if (error !== null) return { ok: false, reason: "failed" };
  if (data.length !== 1) return { ok: false, reason: "not_found" };

  await removeObject(photo.storage_path, supabase);

  return { ok: true };
}

/** The one read both listings are, differing only in whether they ask for one Quote or many. */
async function photosOf(
  filter: { column: "quote_id"; value: string | string[] },
  store: SessionCookieStore,
): Promise<(QuotePhoto & { quoteId: string })[]> {
  const supabase = createSessionClient(store);
  const query = supabase
    .from("quote_photos")
    .select(
      "id, quote_id, storage_path, uploaded_at, " +
        "uploader:users!quote_photos_uploaded_by_user_id_fkey(name)",
    );

  const { data } = await (Array.isArray(filter.value)
    ? query.in(filter.column, filter.value)
    : query.eq(filter.column, filter.value)
  )
    .order("uploaded_at")
    .order("id")
    .overrideTypes<QuotePhotoDbRow[], { merge: false }>();

  const rows = data ?? [];
  const urls = await signedReadUrls(
    rows.map((row) => row.storage_path),
    supabase,
  );

  return rows.map((row) => ({
    id: row.id,
    quoteId: row.quote_id,
    url: urls.get(row.storage_path) ?? "",
    uploadedAt: row.uploaded_at,
    uploadedByName: row.uploader?.name ?? "",
  }));
}

/** Written out rather than inferred, for the reason `ReferenceImageDbRow` is. */
type QuotePhotoDbRow = {
  id: string;
  quote_id: string;
  storage_path: string;
  uploaded_at: string;
  uploader: { name: string } | null;
};

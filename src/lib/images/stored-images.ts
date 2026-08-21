import "server-only";

import {
  entityFolder,
  imageContentTypes,
  imagesBucket,
  isStorableImage,
  maxImageBytes,
  maxImagesAtOnce,
  type ImageOwner,
  type ImageProblem,
  type ImageResult,
  type PendingImage,
  type StoredImageUpload,
} from "@/lib/images/images";
import type { createSessionClient } from "@/lib/supabase/session-client";

/**
 * The image path itself, with nothing in it that knows what the pictures are of.
 *
 * Reference Images (#25) and Quote Photos (#26) are the same object to Storage — a
 * photograph off a phone, uploaded browser-to-Storage through a signed URL, read back
 * through another one, never transformed. What makes one a client's picture of what they
 * asked for and the other a supplier's picture of what they can supply is the row that
 * points at it. So the row lives in each feature's own module and everything below the
 * row lives here, once.
 *
 * Every function here takes the caller's *session* client. The signed token is minted
 * against their real session, which is what makes the storage policy — org id as the
 * leading path segment — the thing that decides whether a path is theirs to write.
 * Nothing here re-checks the org, because nothing here could do it better.
 */

type Client = ReturnType<typeof createSessionClient>;

/** How long a signed read URL lives. Long enough to open a lightbox, and no longer. */
const readUrlSeconds = 60 * 60;

/**
 * Is this batch one we are willing to spend a round trip per image on?
 *
 * Counted and measured before anything is signed, all or nothing. Several pictures are
 * one act — five off one email, three off one supplier call — and a batch that
 * half-succeeded would leave somebody counting thumbnails to work out which never made
 * it. Compression runs first in the browser, so an image still over the cap here is a
 * genuinely unusual file rather than a phone photo.
 */
export function pendingProblem(images: PendingImage[]): ImageProblem | null {
  if (images.length === 0) return "no_images";
  if (images.length > maxImagesAtOnce) return "too_many";

  for (const image of images) {
    if (image.byteSize > maxImageBytes) return "too_large";
    if (!isStorableImage(image.contentType)) return "not_an_image";
  }

  return null;
}

/**
 * A signed upload per image, in the order they were given, into one entity's folder.
 *
 * Handing back a token rather than accepting bytes is the whole point: the upload goes
 * straight from the phone to Storage, so a picture never costs this app's bandwidth and
 * never depends on it staying up mid-transfer. It is also the only route measured
 * working inside the WeCom in-app webview, which is where this app is opened.
 */
export async function signUploads(
  {
    orgId,
    owner,
    entityId,
    images,
  }: { orgId: string; owner: ImageOwner; entityId: string; images: PendingImage[] },
  supabase: Client,
): Promise<ImageResult<{ uploads: StoredImageUpload[] }>> {
  const problem = pendingProblem(images);

  if (problem) return { ok: false, reason: problem };

  const folder = entityFolder(orgId, owner, entityId);
  const uploads: StoredImageUpload[] = [];

  for (const image of images) {
    const { data, error } = await supabase.storage
      .from(imagesBucket)
      .createSignedUploadUrl(objectPath(folder, image.contentType));

    if (error !== null || !data) return { ok: false, reason: "failed" };

    uploads.push({ storagePath: data.path, token: data.token });
  }

  return { ok: true, uploads };
}

/**
 * Check the two halves of what the browser claims: that these paths are this entity's,
 * and that something is actually at them.
 *
 * The app is not on the upload path — it signs, the browser uploads, and then it is told
 * what happened — so both halves are hearsay until asked. Without the first check a
 * caller could file one Tender's pictures under another; without the second, a row could
 * name an object that was never uploaded, which renders as a broken image for good.
 */
export async function confirmUploaded(
  {
    orgId,
    owner,
    entityId,
    storagePaths,
  }: { orgId: string; owner: ImageOwner; entityId: string; storagePaths: string[] },
  supabase: Client,
): Promise<ImageProblem | null> {
  if (storagePaths.length === 0) return "no_images";

  const folder = entityFolder(orgId, owner, entityId);
  const prefix = `${folder}/`;
  const names = storagePaths.map((path) => path.slice(prefix.length));

  if (
    !storagePaths.every(
      (path, index) => path.startsWith(prefix) && !names[index].includes("/"),
    )
  ) {
    // The path is not this entity's, so as far as this entity is concerned there is
    // nothing there — the same answer RLS gives for another org's folder.
    return "not_found";
  }

  // One listing rather than one existence check per path: a handful of pictures is the
  // normal batch, and a phone on mobile data pays for every round trip.
  const { data: present, error } = await supabase.storage
    .from(imagesBucket)
    .list(folder, { limit: 1000 });

  if (error !== null) return "failed";

  const uploaded = new Set((present ?? []).map((object) => object.name));

  return names.every((name) => uploaded.has(name)) ? null : "not_uploaded";
}

/**
 * A signed read URL for each path, as a lookup.
 *
 * One call for the whole page: signing is a round trip per URL otherwise, and a screen
 * renders every picture on it at once. A path Storage would not sign is simply absent
 * from the map — the object behind that row has gone, and the row is still worth showing
 * so that somebody can remove it.
 */
export async function signedReadUrls(
  storagePaths: string[],
  supabase: Client,
): Promise<Map<string, string>> {
  if (storagePaths.length === 0) return new Map();

  const { data } = await supabase.storage
    .from(imagesBucket)
    .createSignedUrls(storagePaths, readUrlSeconds);

  const urls = new Map<string, string>();

  for (const entry of data ?? []) {
    // `path` is nullable on the way back and `signedUrl` is empty when Storage refused
    // to sign one. Either way there is nothing to render, and an entry missing from this
    // map is what the callers already treat as "the object behind this row has gone".
    if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  }

  return urls;
}

/**
 * Take the bytes away, after the row naming them has gone.
 *
 * That order is the honest one: the row is what a screen shows, so deleting it is what
 * the user asked for. A failure here leaves a few bytes nothing can reach, against the
 * other order, where a failed row delete leaves a permanently broken picture on screen.
 * There is deliberately no retention rule in v1, so nothing sweeps up after either way.
 */
export async function removeObject(
  storagePath: string,
  supabase: Client,
): Promise<void> {
  await supabase.storage.from(imagesBucket).remove([storagePath]);
}

/**
 * A new object in a folder.
 *
 * The uuid is the file name, not the one the phone gave it: two pictures off the same
 * camera are routinely both `IMG_0042.HEIC`, and a path collision would have the second
 * upload refused or — worse, with upsert — silently replace the first.
 */
function objectPath(folder: string, contentType: string): string {
  return `${folder}/${crypto.randomUUID()}.${imageContentTypes.get(contentType)}`;
}

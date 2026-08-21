/**
 * What both ends of the image path have to agree on.
 *
 * Deliberately not `server-only`, and deliberately holding no client: the compressor and
 * the uploader run in the browser, the signing and recording run on the server, and the
 * bucket name, the size cap and the set of acceptable content types have to be the same
 * number in both places or the browser spends a phone's data allowance discovering the
 * server's opinion.
 */

/** One private bucket for every image the app stores — buildspec_2.md assumption A13. */
export const imagesBucket = "images";

/**
 * 10 MB per image, and the same figure as the bucket's own `file_size_limit`.
 * buildspec_2.md assumption A10 settled that there is a hard cap and left the number
 * open.
 *
 * Checked three times on purpose: the uploader refuses before it spends the upload, the
 * signing step refuses before it mints a token, and the bucket refuses a body already
 * being read. Compression runs first, so a file still over this afterwards is a genuinely
 * unusual one rather than a phone photo.
 */
export const maxImageBytes = 10 * 1024 * 1024;

/**
 * How many images one act may carry.
 *
 * Five is the shape of the email this feature exists for; ten is a generous ceiling that
 * still stops a whole photo library being selected by a mis-tap. Enforced on the server
 * as well as in the picker, because signing is a round trip per image.
 */
export const maxImagesAtOnce = 10;

/**
 * What Storage will accept, and the extension each one is stored under.
 *
 * A closed set rather than a `startsWith("image/")` test, kept in step by hand with
 * `allowed_mime_types` on the bucket: a content type this map does not know would be
 * signed happily and then refused mid-upload, which is the one place a refusal costs
 * something.
 *
 * HEIC and HEIF are here for the compressor's fallback path, not the happy one. An
 * iPhone hands over HEIC; the compressor re-encodes to JPEG unless it cannot, and an
 * image it could not decode is uploaded as it came rather than dropped. So the bucket
 * holds mostly JPEG and occasionally whatever the phone produced.
 */
export const imageContentTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

export function isStorableImage(contentType: string): boolean {
  return imageContentTypes.has(contentType);
}

/**
 * The file input's `accept`.
 *
 * `image/*` rather than the list above, because a phone's photo picker reads it as "show
 * me the photo library" and a narrower list makes some pickers show nothing at all. The
 * real gate is `isStorableImage`, on the server, where a picker cannot argue with it.
 * Note the absence of `capture`: Reference Images arrive by email, so the gesture here is
 * *choose the five that came in*, not *take one now* — that hint belongs on the Quote
 * Photo input.
 */
export const imageAccept = "image/*";

/**
 * The Quote Photo input's `accept`.
 *
 * `capture` is the difference from {@link imageAccept}, and it is a difference in
 * *gesture*: a Quote Photo is taken during or just after the call, on the phone in the
 * hand, so the camera is the thing to open. A Reference Image arrived by email an hour
 * ago and is already in the library.
 *
 * **`capture` is a hint, not a guarantee** (buildspec_2.md A4). It was measured opening
 * the camera straight away inside the WeCom webview on an iPhone; Android is unmeasured,
 * and the research on Android WebView is bad enough that the picker has to stay reachable
 * without it. A visible file-picker fallback beside this input is therefore required,
 * not optional — see `quote-photo-uploader.tsx`.
 */
export const photoAccept = "image/*";

/**
 * Which entity a stored image hangs off, and the folder segment that says so.
 *
 * The path is `{org_id}/{entity}/{entity_id}/{uuid}.{ext}`, and the org id leads because
 * it is the only segment the storage policy can match cheaply. This middle segment is
 * what keeps a Tender's pictures and a Quote's photos apart inside one org's folder —
 * they are the same kind of object to Storage, and the row that points at one is the
 * only thing that makes it a client's picture or a supplier's.
 */
export type ImageOwner = "tenders" | "quotes";

/** The one folder an entity's images may live in. */
export function entityFolder(orgId: string, owner: ImageOwner, entityId: string): string {
  return `${orgId}/${owner}/${entityId}`;
}

/** One image as the browser knows it, before it has uploaded anything. */
export type PendingImage = { contentType: string; byteSize: number };

/** One signed upload: where the object goes, and the token that lets it. */
export type StoredImageUpload = { storagePath: string; token: string };

/**
 * Every way an image write can be refused, as a list rather than a bare union, for the
 * same reason `tenderProblems` is one: the wording lives in the message files, and a
 * reason with none renders to the user as its own key. `messages.test.ts` walks this to
 * hold both locales to it.
 *
 * One union for Reference Images and Quote Photos together. The reasons are the same
 * sentences — an upload that did not finish is an upload that did not finish — and two
 * copies would be two sets of wording to keep in step for no difference a reader could
 * see.
 */
export const imageProblems = [
  "forbidden",
  "not_found",
  "no_images",
  "too_many",
  "too_large",
  "not_an_image",
  "not_uploaded",
  "failed",
] as const;

export type ImageProblem = (typeof imageProblems)[number];

export type ImageResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; reason: ImageProblem };

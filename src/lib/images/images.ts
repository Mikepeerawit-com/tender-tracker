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

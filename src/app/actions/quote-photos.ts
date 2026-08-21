"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import type { ImageProblem, PendingImage } from "@/lib/images/images";
import {
  recordQuotePhotos,
  removeQuotePhoto,
  signQuotePhotoUploads,
  type QuotePhotoUpload,
} from "@/lib/images/quote-photos";

/**
 * The request boundary for Quote Photos — the same three-step shape as Reference
 * Images, because it is the same image path underneath.
 *
 * Two of these are not form actions and cannot be. An upload is sign, upload straight to
 * Storage, then record, with the browser doing the middle step. The bytes never pass
 * through here, which is the whole reason the path works from a phone on mobile data
 * inside the WeCom in-app webview.
 */

export type QuotePhotoFormState = { error?: ImageProblem };

/** Step one: a token per photo, or the reason there is none. */
export async function signQuotePhotoUploadsAction(input: {
  quoteId: string;
  images: PendingImage[];
}): Promise<
  { ok: true; uploads: QuotePhotoUpload[] } | { ok: false; reason: ImageProblem }
> {
  return signQuotePhotoUploads(input, await cookies());
}

/** Step three: what actually landed, which is not always what was signed. */
export async function recordQuotePhotosAction(input: {
  quoteId: string;
  storagePaths: string[];
  tenderId: string;
}): Promise<QuotePhotoFormState> {
  const result = await recordQuotePhotos(input, await cookies());

  return afterPhotoWrite(result, input.tenderId);
}

export async function removeQuotePhotoAction(
  _previous: QuotePhotoFormState,
  formData: FormData,
): Promise<QuotePhotoFormState> {
  const tenderId = text(formData, "tenderId");
  const result = await removeQuotePhoto(text(formData, "photoId"), await cookies());

  return afterPhotoWrite(result, tenderId);
}

/**
 * Report the refusal, or refresh the Tender.
 *
 * The whole `/tenders/[id]` subtree: photos are added on the Item's sourcing screen and
 * counted on the comparison sheet, and because read URLs are signed and perishable, a
 * page left un-revalidated ends up showing not stale pictures but none.
 */
function afterPhotoWrite(
  result: { ok: true } | { ok: false; reason: ImageProblem },
  tenderId: string,
): QuotePhotoFormState {
  if (!result.ok) return { error: result.reason };

  revalidatePath(`/tenders/${tenderId}`, "layout");

  return {};
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

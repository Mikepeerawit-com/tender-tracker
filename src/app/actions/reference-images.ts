"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import {
  assignReferenceImage,
  recordReferenceImages,
  removeReferenceImage,
  signReferenceImageUploads,
  type PendingImage,
  type ReferenceImageProblem,
  type ReferenceImageUpload,
} from "@/lib/images/reference-images";

/**
 * The request boundary for Reference Images. `cookies()` is resolved here and handed
 * down, so everything under `@/lib/images` is reachable from a test without a Next
 * request context — the same shape as the Tender actions.
 *
 * Two of these four are not form actions, and cannot be. An upload is three steps with
 * the browser doing the middle one: sign, upload straight to Storage, then record. The
 * bytes never pass through here, which is the whole reason the path works from a phone
 * on mobile data inside the WeCom webview.
 */

export type ReferenceImageFormState = { error?: ReferenceImageProblem };

/** Step one: a token per image, or the reason there is none. */
export async function signReferenceImageUploadsAction(input: {
  tenderId: string;
  images: PendingImage[];
}): Promise<
  { ok: true; uploads: ReferenceImageUpload[] } | { ok: false; reason: ReferenceImageProblem }
> {
  return signReferenceImageUploads(input, await cookies());
}

/**
 * Step three: what actually landed.
 *
 * `storagePaths` is the subset that uploaded, not the batch that was signed — a phone
 * that dropped its signal halfway through five pictures should keep the three that made
 * it rather than lose all five.
 */
export async function recordReferenceImagesAction(input: {
  tenderId: string;
  storagePaths: string[];
}): Promise<ReferenceImageFormState> {
  const result = await recordReferenceImages(input, await cookies());

  return afterImageWrite(result, input.tenderId);
}

export async function assignReferenceImageAction(
  _previous: ReferenceImageFormState,
  formData: FormData,
): Promise<ReferenceImageFormState> {
  const tenderId = text(formData, "tenderId");
  const result = await assignReferenceImage(
    {
      imageId: text(formData, "imageId"),
      // The picker's "not yet assigned" option posts an empty value, which is the
      // request to take the picture back off whichever Item it is on.
      tenderItemId: text(formData, "tenderItemId") || null,
    },
    await cookies(),
  );

  return afterImageWrite(result, tenderId);
}

export async function removeReferenceImageAction(
  _previous: ReferenceImageFormState,
  formData: FormData,
): Promise<ReferenceImageFormState> {
  const tenderId = text(formData, "tenderId");
  const result = await removeReferenceImage(text(formData, "imageId"), await cookies());

  return afterImageWrite(result, tenderId);
}

/**
 * Report the refusal, or refresh the Tender.
 *
 * The whole `/tenders/[id]` subtree: images are uploaded and assigned on the edit screen
 * and read on the detail screen, so revalidating only the page the form is on is how the
 * detail screen ends up showing yesterday's pictures — and, because read URLs are
 * signed and perishable, how it ends up showing none.
 */
function afterImageWrite(
  result: { ok: true } | { ok: false; reason: ReferenceImageProblem },
  tenderId: string,
): ReferenceImageFormState {
  if (!result.ok) return { error: result.reason };

  revalidatePath(`/tenders/${tenderId}`, "layout");

  return {};
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

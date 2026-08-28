"use client";

import { useState } from "react";

import { compressImage } from "@/lib/images/compress";
import {
  imagesBucket,
  maxImageBytes,
  maxImagesAtOnce,
  type ImageProblem,
  type PendingImage,
  type StoredImageUpload,
  type UploadOutcome,
} from "@/lib/images/images";
import { createStorageClient } from "@/lib/supabase/storage-client";

/**
 * Three steps, and the middle one is not this app's.
 *
 * The server signs a URL per picture, the browser uploads straight to Storage, and then
 * the server records what landed. The bytes never pass through a route handler, which is
 * what makes the path survive a phone on mobile data inside the WeCom in-app webview —
 * the one place this app is opened from, and the one place there is no escape to Safari
 * when something hangs.
 *
 * The loop is here rather than in each uploader because it is the same loop for a
 * client's Reference Images and a supplier's Quote Photos, and because everything
 * interesting about it is in the failure paths — the partial batch, the retry after a
 * dropped signal, the count that has to keep meaning something. Two copies would be two
 * chances to get those wrong, and the copy that got them wrong would be the one nobody
 * had a picture from.
 *
 * ## Where a batch is filed is decided when it runs, not when the screen was drawn
 *
 * `sign` and `record` are arguments to {@link ImageUpload.upload}, not to the hook. They
 * used to be the hook's own configuration, closed over an entity id known at render — and
 * that is exactly the assumption the create-a-Quote form cannot hold to. There, the Quote
 * does not exist while the photos are being picked; its id arrives from the submit that
 * writes it, a beat before the batch runs. Naming the destination per batch is what lets
 * the same loop serve a Quote that has existed for a week and one that has existed for a
 * hundred milliseconds.
 */

/** How far through a batch the upload is. Null when nothing is in flight. */
export type UploadProgress = { done: number; total: number };

/** Where one batch is being filed: how to get keys for it, and how to record what landed. */
export type ImageDestination = {
  sign: (
    images: PendingImage[],
  ) => Promise<
    { ok: true; uploads: StoredImageUpload[] } | { ok: false; reason: ImageProblem }
  >;
  record: (storagePaths: string[]) => Promise<{ error?: ImageProblem }>;
};

export type ImageUpload = {
  error: ImageProblem | null;
  progress: UploadProgress | null;
  busy: boolean;
  /** Discard whatever the last attempt said, without starting another. */
  clearError: () => void;
  /**
   * Run one batch, and say what became of it.
   *
   * The returned {@link UploadOutcome} is the same fact as `error`, plus the one thing
   * only this loop can know: *which* files are still to do. A caller with the picker
   * still on screen can ignore it. The create-a-Quote form cannot — by the time it hears,
   * the price is written and the only useful sentence names the photos to try again.
   */
  upload: (files: File[], to: ImageDestination) => Promise<UploadOutcome>;
};

export function useImageUpload(): ImageUpload {
  const [error, setError] = useState<ImageProblem | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  /** Report it once, in both directions. */
  function refuse(reason: ImageProblem, failed: File[]): UploadOutcome {
    setError(reason);

    return { failed, error: reason };
  }

  async function upload(files: File[], to: ImageDestination): Promise<UploadOutcome> {
    setError(null);

    if (files.length > maxImagesAtOnce) return refuse("too_many", files);

    setProgress({ done: 0, total: files.length });

    try {
      const prepared = [];

      for (const file of files) {
        prepared.push(await compressImage(file));
      }

      // Checked here as well as on the server, because here is the only place it can be
      // said *before* the upload rather than instead of it.
      if (prepared.some((file) => file.size > maxImageBytes)) {
        return refuse("too_large", files);
      }

      const signed = await to.sign(
        prepared.map((file) => ({ contentType: file.type, byteSize: file.size })),
      );

      if (!signed.ok) return refuse(signed.reason, files);

      const client = createStorageClient();
      const uploaded: string[] = [];
      // Indexed against `files` rather than `prepared`: the compressor re-encodes to JPEG
      // and renames as it goes, and the name worth showing somebody is the one they saw
      // in the picker.
      const failed: File[] = [];

      // One at a time, and in step with `prepared`: the server signs a URL per picture in
      // the order it was given them. Sequential rather than parallel on purpose — several
      // concurrent uploads off one phone share one uplink and only make each other slow,
      // and a serial loop is what lets the count below mean anything.
      for (const [index, signedUpload] of signed.uploads.entries()) {
        const { error: uploadError } = await client.storage
          .from(imagesBucket)
          // No `contentType` option: with a `File` body this goes out as multipart, and
          // the part carries `file.type` itself. Passing one would read as though it
          // decided something.
          .uploadToSignedUrl(signedUpload.storagePath, signedUpload.token, prepared[index]);

        if (uploadError) failed.push(files[index]);
        else uploaded.push(signedUpload.storagePath);

        setProgress({ done: index + 1, total: prepared.length });
      }

      if (uploaded.length === 0) return refuse("failed", files);

      // Only what landed. A signal that dropped after the third picture should keep the
      // three, not lose all five — and the server refuses a path nothing was uploaded to,
      // so claiming the other two would refuse the batch that did work.
      const recorded = await to.record(uploaded);

      // Nothing was written down, so nothing counts as done — the objects that did land
      // are orphans with no row pointing at them, which is what every one of these files
      // still being outstanding means.
      if (recorded.error) return refuse(recorded.error, files);

      if (failed.length > 0) return refuse("failed", failed);

      return { failed: [], error: null };
    } finally {
      setProgress(null);
    }
  }

  return {
    error,
    progress,
    busy: progress !== null,
    clearError: () => setError(null),
    upload,
  };
}

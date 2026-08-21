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
 */

/** How far through a batch the upload is. Null when nothing is in flight. */
export type UploadProgress = { done: number; total: number };

export type ImageUpload = {
  error: ImageProblem | null;
  progress: UploadProgress | null;
  busy: boolean;
  /** Discard whatever the last attempt said, without starting another. */
  clearError: () => void;
  upload: (files: File[]) => Promise<void>;
};

export function useImageUpload({
  sign,
  record,
}: {
  sign: (
    images: PendingImage[],
  ) => Promise<
    { ok: true; uploads: StoredImageUpload[] } | { ok: false; reason: ImageProblem }
  >;
  record: (storagePaths: string[]) => Promise<{ error?: ImageProblem }>;
}): ImageUpload {
  const [error, setError] = useState<ImageProblem | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  async function upload(files: File[]) {
    setError(null);

    if (files.length > maxImagesAtOnce) {
      setError("too_many");
      return;
    }

    setProgress({ done: 0, total: files.length });

    try {
      const prepared = [];

      for (const file of files) {
        prepared.push(await compressImage(file));
      }

      // Checked here as well as on the server, because here is the only place it can be
      // said *before* the upload rather than instead of it.
      if (prepared.some((file) => file.size > maxImageBytes)) {
        setError("too_large");
        return;
      }

      const signed = await sign(
        prepared.map((file) => ({ contentType: file.type, byteSize: file.size })),
      );

      if (!signed.ok) {
        setError(signed.reason);
        return;
      }

      const client = createStorageClient();
      const uploaded: string[] = [];

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

        if (!uploadError) uploaded.push(signedUpload.storagePath);

        setProgress({ done: index + 1, total: prepared.length });
      }

      if (uploaded.length === 0) {
        setError("failed");
        return;
      }

      // Only what landed. A signal that dropped after the third picture should keep the
      // three, not lose all five — and the server refuses a path nothing was uploaded to,
      // so claiming the other two would refuse the batch that did work.
      const recorded = await record(uploaded);

      if (recorded.error) {
        setError(recorded.error);
        return;
      }

      if (uploaded.length < prepared.length) setError("failed");
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

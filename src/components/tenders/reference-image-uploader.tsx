"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  recordReferenceImagesAction,
  signReferenceImageUploadsAction,
} from "@/app/actions/reference-images";
import { compressImage } from "@/lib/images/compress";
import {
  imageAccept,
  imagesBucket,
  maxImageBytes,
  maxImagesAtOnce,
} from "@/lib/images/images";
import type { ReferenceImageProblem } from "@/lib/images/reference-images";
import { createStorageClient } from "@/lib/supabase/storage-client";

/**
 * Drop five pictures in at once, against the Tender.
 *
 * The upload is per-Tender and the assignment to an Item happens afterwards, because
 * that is how the work arrives: one email, five pictures, and no way to tell from the
 * email which of the Tender's Items each is about. So there is no Item picker here —
 * they land Unassigned and get placed on the gallery below.
 *
 * Three steps, and the middle one is not this app's. The server signs a URL per image,
 * the browser uploads straight to Storage, and then the server records what landed. The
 * bytes never pass through a route handler, which is what makes the path survive a phone
 * on mobile data inside the WeCom in-app webview — the one place this app is opened from
 * and the one place there is no escape to Safari when something hangs.
 */

type Progress = { done: number; total: number };

export function ReferenceImageUploader({ tenderId }: { tenderId: string }) {
  const t = useTranslations("tenders.referenceImages");
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<ReferenceImageProblem | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  const busy = progress !== null;

  async function onPicked(files: File[]) {
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
      // said before the upload rather than instead of it.
      if (prepared.some((file) => file.size > maxImageBytes)) {
        setError("too_large");
        return;
      }

      const signed = await signReferenceImageUploadsAction({
        tenderId,
        images: prepared.map((file) => ({
          contentType: file.type,
          byteSize: file.size,
        })),
      });

      if (!signed.ok) {
        setError(signed.reason);
        return;
      }

      const client = createStorageClient();
      const uploaded: string[] = [];

      // One at a time, and in step with `prepared`: the server signs a URL per image in
      // the order it was given them. Sequential rather than parallel on purpose — five
      // concurrent uploads off one phone share one uplink and only make each other slow,
      // and a serial loop is what lets the count below mean anything.
      for (const [index, upload] of signed.uploads.entries()) {
        const { error: uploadError } = await client.storage
          .from(imagesBucket)
          // No `contentType` option: with a `File` body this goes out as multipart, and
          // the part carries `file.type` itself. Passing one would read as though it
          // decided something.
          .uploadToSignedUrl(upload.storagePath, upload.token, prepared[index]);

        if (!uploadError) uploaded.push(upload.storagePath);

        setProgress({ done: index + 1, total: prepared.length });
      }

      if (uploaded.length === 0) {
        setError("failed");
        return;
      }

      // Only what landed. A signal that dropped after the third picture should keep the
      // three, not lose all five — and the server refuses a path nothing was uploaded to,
      // so claiming the other two would refuse the batch that did work.
      const recorded = await recordReferenceImagesAction({
        tenderId,
        storagePaths: uploaded,
      });

      if (recorded.error) {
        setError(recorded.error);
        return;
      }

      if (uploaded.length < prepared.length) setError("failed");
    } finally {
      setProgress(null);

      // However the attempt ended, and especially when it failed: the input keeps its old
      // FileList otherwise, so re-picking the same five fires no `change` event at all —
      // which turns the retry after a dropped signal, the case this whole function is
      // shaped around, into a tap that looks like a hang.
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t("add")}</span>
        <input
          ref={input}
          type="file"
          multiple
          accept={imageAccept}
          disabled={busy}
          className="file:bg-muted file:text-foreground hover:file:bg-muted/70 border-input h-11 w-full cursor-pointer rounded-lg border bg-transparent text-sm file:mr-3 file:h-full file:cursor-pointer file:rounded-l-lg file:border-0 file:px-3 file:text-sm file:font-medium disabled:pointer-events-none disabled:opacity-50"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];

            if (files.length > 0) void onPicked(files);
          }}
        />
      </label>

      <p className="text-muted-foreground text-xs">{t("hint")}</p>

      {progress ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("uploading", { done: progress.done, total: progress.total })}
        </p>
      ) : null}

      <ReferenceImageProblemNotice error={error ?? undefined} />
    </div>
  );
}

/**
 * Whatever was refused, said in the reader's language.
 *
 * Its own component for the reason `TenderProblemNotice` is one: every Reference Image
 * form reports through it, so a reason added to `ReferenceImageProblem` shows up as a
 * missing key in both message files rather than as an unexplained failed upload.
 */
export function ReferenceImageProblemNotice({
  error,
}: {
  error?: ReferenceImageProblem;
}) {
  const t = useTranslations("tenders.referenceImages.error");

  if (!error) return null;

  return (
    <p
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
    >
      {t(error)}
    </p>
  );
}

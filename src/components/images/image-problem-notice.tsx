"use client";

import { useTranslations } from "next-intl";

import type { ImageProblem } from "@/lib/images/images";

/**
 * Whatever an image write was refused for, said in the reader's language.
 *
 * One component and one set of wording for Reference Images and Quote Photos alike, for
 * the reason they share a refusal union: "one of those pictures did not finish uploading"
 * is the same sentence whoever sent the picture. A reason added to `ImageProblem` shows
 * up as a missing key in both message files rather than as an unexplained failed upload
 * — which is the one moment somebody is standing there holding a phone with pictures on
 * it and no idea what to do next.
 */
export function ImageProblemNotice({ error }: { error?: ImageProblem }) {
  const t = useTranslations("images.error");

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

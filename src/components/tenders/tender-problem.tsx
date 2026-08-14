"use client";

import { useTranslations } from "next-intl";

import type { TenderProblem } from "@/lib/tenders/tenders";

/**
 * Whatever the server refused, said in the reader's language.
 *
 * Every form on these screens reports through this one component, so a reason added to
 * `TenderProblem` shows up as a missing key in both message files rather than as an
 * unexplained failed save.
 */
export function TenderProblemNotice({ error }: { error?: TenderProblem }) {
  const t = useTranslations("tenders.error");

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

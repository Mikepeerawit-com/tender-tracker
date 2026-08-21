"use client";

import { useTranslations } from "next-intl";

import type { QuoteProblem } from "@/lib/quotes/quotes";

/**
 * Whatever the server refused, said in the reader's language.
 *
 * Every form on the sourcing screen reports through this one component, so a reason added
 * to `QuoteProblem` shows up as a missing key in both message files rather than as an
 * unexplained failed save — which here means a price that did not get written down.
 */
export function QuoteProblemNotice({ error }: { error?: QuoteProblem }) {
  const t = useTranslations("quotes.error");

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

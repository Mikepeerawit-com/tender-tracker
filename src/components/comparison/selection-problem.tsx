"use client";

import { useTranslations } from "next-intl";

import type { SelectionProblem } from "@/lib/comparison/sheet";

/**
 * Whatever the server refused a selection for, said in the reader's language.
 *
 * There is very little that can go wrong here — the list is three reasons long — but a
 * Select button that silently does nothing is worse on this screen than anywhere else:
 * the row already looks pressed, and the person moves on believing the Item is decided.
 */
export function SelectionProblemNotice({ error }: { error?: SelectionProblem }) {
  const t = useTranslations("comparison.error");

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

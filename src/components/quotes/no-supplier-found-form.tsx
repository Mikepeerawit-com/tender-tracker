"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import {
  clearNoSupplierFoundAction,
  recordNoSupplierFoundAction,
  type QuoteFormState,
} from "@/app/actions/quotes";
import { QuoteProblemNotice } from "@/components/quotes/quote-problem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NoSupplierFound } from "@/lib/quotes/quotes";

const initialState: QuoteFormState = {};

/**
 * "I could not source this."
 *
 * A third state, and the whole reason it exists is that it is *not* silence. An Item
 * nobody has touched and an Item somebody has already given up on mean opposite things
 * when deciding whether to Bid at all — and only one of them is worth chasing an Assignee
 * about. Recording it is also how an Assignee stops the app asking them for work that
 * cannot be done.
 *
 * It is per-Assignee, never per-Item, and the screen says so. Assignees compete rather
 * than divide (ADR-0004): one of them failing to find a supplier is a fact about their
 * suppliers, not a verdict on the Item, and a colleague may well be holding a price for
 * the same thing.
 */
export function NoSupplierFoundForm({
  tenderId,
  tenderItemId,
  mine,
  others,
}: {
  tenderId: string;
  tenderItemId: string;
  /** The caller's own record, if they have left one. */
  mine: NoSupplierFound | null;
  /** Everybody else's, shown as fact rather than as something to act on. */
  others: NoSupplierFound[];
}) {
  const t = useTranslations("quotes.noSupplier");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t("title")}</h3>
        <p className="text-muted-foreground text-xs">{t("hint")}</p>
      </div>

      {others.length > 0 ? (
        <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
          {others.map((other) => (
            <li key={other.userId}>
              {other.note
                ? t("byWithNote", { name: other.name, note: other.note })
                : t("by", { name: other.name })}
            </li>
          ))}
        </ul>
      ) : null}

      {mine ? (
        <ClearForm tenderId={tenderId} tenderItemId={tenderItemId} mine={mine} />
      ) : (
        <RecordForm tenderId={tenderId} tenderItemId={tenderItemId} />
      )}
    </div>
  );
}

function RecordForm({
  tenderId,
  tenderItemId,
}: {
  tenderId: string;
  tenderItemId: string;
}) {
  const t = useTranslations("quotes.noSupplier");
  const [state, formAction, isPending] = useActionState(
    recordNoSupplierFoundAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="tenderItemId" value={tenderItemId} />

      <QuoteProblemNotice error={state.error} />

      <div className="flex flex-col gap-2">
        <Label htmlFor={`nsf-note-${tenderItemId}`}>{t("note")}</Label>
        <Input
          id={`nsf-note-${tenderItemId}`}
          name="note"
          placeholder={t("notePlaceholder")}
          className="h-11"
        />
      </div>

      <div>
        <Button type="submit" variant="outline" disabled={isPending} className="h-11">
          {t("record")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Taking it back, which happens: a supplier rings back, or somebody thinks of one more to
 * try. Entering a Quote clears it too, on the server — an Assignee who has just sourced
 * the Item is no longer somebody who could not.
 */
function ClearForm({
  tenderId,
  tenderItemId,
  mine,
}: {
  tenderId: string;
  tenderItemId: string;
  mine: NoSupplierFound;
}) {
  const t = useTranslations("quotes.noSupplier");
  const [state, formAction, isPending] = useActionState(
    clearNoSupplierFoundAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="tenderItemId" value={tenderItemId} />

      <p className="text-sm">{mine.note ? t("mineWithNote", { note: mine.note }) : t("mine")}</p>

      <QuoteProblemNotice error={state.error} />

      <div>
        <Button type="submit" variant="ghost" disabled={isPending} className="h-11">
          {t("clear")}
        </Button>
      </div>
    </form>
  );
}

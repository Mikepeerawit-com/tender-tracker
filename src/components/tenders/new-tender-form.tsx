"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

import { createTenderAction, type TenderFormState } from "@/app/actions/tenders";
import { TenderFieldInputs } from "@/components/tenders/tender-fields";
import { TenderItemInputs } from "@/components/tenders/tender-item-fields";
import { TenderProblemNotice } from "@/components/tenders/tender-problem";
import { Button } from "@/components/ui/button";
import type { OwnerOption } from "@/lib/org/members";

const initialState: TenderFormState = {};

/**
 * Recording a Tender and everything it asks for, in one submit.
 *
 * The Items are rows in the same form rather than a second step, because a multi-item
 * Tender is one opportunity: splitting it in two invites the Owner to save the Tender,
 * get distracted, and leave an opportunity in the list that asks for nothing.
 */
export function NewTenderForm({
  members,
  defaultOwnerId,
}: {
  members: OwnerOption[];
  defaultOwnerId: string;
}) {
  const t = useTranslations("tenders");
  const [state, formAction, isPending] = useActionState(createTenderAction, initialState);

  // Row identity, not row content: the inputs are uncontrolled, so a stable key is what
  // stops removing one row from re-labelling the values still typed into the others.
  const [rowIds, setRowIds] = useState<number[]>([0]);
  const [nextRowId, setNextRowId] = useState(1);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <TenderProblemNotice error={state.error} />

      <TenderFieldInputs
        members={members}
        // What the last submit was refused for, if it was: React restores every input
        // from these on submit, so an empty set here is a screenful of typing lost to a
        // date in the wrong order.
        defaults={
          state.submitted?.tender ?? {
            clientName: "",
            title: "",
            // No date is pre-filled. "Today" is a day in the org's timezone, and a
            // server running UTC would offer the wrong one for seven hours of every
            // evening.
            dateReceived: "",
            internalQuoteDeadline: "",
            clientSubmissionDeadline: "",
            expectedDecisionDate: "",
            ownerUserId: defaultOwnerId,
            notes: "",
          }
        }
      />

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">{t("item.plural")}</h2>
          <p className="text-muted-foreground text-xs">{t("item.hint")}</p>
        </div>

        {rowIds.map((rowId, index) => (
          <div
            key={rowId}
            className="border-border flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">
                {t("item.numbered", { number: index + 1 })}
              </span>
              {rowIds.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRowIds(rowIds.filter((id) => id !== rowId))}
                >
                  {t("item.remove")}
                </Button>
              ) : null}
            </div>
            {/* The rows post in document order, so the nth row's values come back at
                the nth index — the same pairing the action reads them by. */}
            <TenderItemInputs
              domId={`item-${rowId}`}
              defaults={state.submitted?.items?.[index]}
            />
          </div>
        ))}

        <div>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              setRowIds([...rowIds, nextRowId]);
              setNextRowId(nextRowId + 1);
            }}
          >
            {t("item.add")}
          </Button>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending} className="h-11">
          {isPending ? t("form.saving") : t("form.create")}
        </Button>
        <Button variant="ghost" className="h-11" nativeButton={false} render={<Link href="/tenders" />}>
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}

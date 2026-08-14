"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { updateTenderAction, type TenderFormState } from "@/app/actions/tenders";
import { TenderFieldInputs } from "@/components/tenders/tender-fields";
import { TenderProblemNotice } from "@/components/tenders/tender-problem";
import { Button } from "@/components/ui/button";
import type { OwnerOption } from "@/lib/org/members";
import { tenderAsSubmitted } from "@/lib/tenders/tender-form";
import type { TenderFields } from "@/lib/tenders/tenders";

const initialState: TenderFormState = {};

/**
 * The Tender's own fields. Its Items are edited one at a time alongside, because an
 * Item can be removed and a form that both edits and deletes rows in one submit has to
 * invent a way to say which.
 */
export function EditTenderForm({
  tenderId,
  members,
  defaults,
}: {
  tenderId: string;
  members: OwnerOption[];
  defaults: TenderFields;
}) {
  const t = useTranslations("tenders");
  const [state, formAction, isPending] = useActionState(updateTenderAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="tenderId" value={tenderId} />

      <TenderProblemNotice error={state.error} />
      <TenderFieldInputs
        members={members}
        defaults={state.submitted?.tender ?? tenderAsSubmitted(defaults)}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending} className="h-11">
          {isPending ? t("form.saving") : t("form.save")}
        </Button>
        <Button
          variant="ghost"
          className="h-11"
          nativeButton={false} render={<Link href={`/tenders/${tenderId}`} />}
        >
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}

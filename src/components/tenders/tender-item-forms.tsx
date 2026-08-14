"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import {
  addTenderItemAction,
  removeTenderItemAction,
  updateTenderItemAction,
  type TenderFormState,
} from "@/app/actions/tenders";
import { TenderItemInputs } from "@/components/tenders/tender-item-fields";
import { TenderProblemNotice } from "@/components/tenders/tender-problem";
import { Button } from "@/components/ui/button";
import { itemAsSubmitted } from "@/lib/tenders/tender-form";
import type { TenderItem } from "@/lib/tenders/tenders";

const initialState: TenderFormState = {};

/** One existing Item: save its edits, or take it off the Tender. */
export function EditTenderItemForm({
  tenderId,
  item,
  removable,
}: {
  tenderId: string;
  item: TenderItem;
  removable: boolean;
}) {
  const t = useTranslations("tenders");
  const [state, formAction, isPending] = useActionState(
    updateTenderItemAction,
    initialState,
  );

  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="tenderId" value={tenderId} />
        <input type="hidden" name="itemId" value={item.id} />

        <TenderProblemNotice error={state.error} />
        {/* What the last submit was refused for, if it was — otherwise the Item as it
            is saved. React restores the inputs from these on every submit. */}
        <TenderItemInputs
          domId={`item-${item.id}`}
          defaults={state.submitted?.items?.[0] ?? itemAsSubmitted(item)}
        />

        <div>
          <Button
            type="submit"
            variant="outline"
            disabled={isPending}
            className="h-11"
          >
            {isPending ? t("form.saving") : t("form.save")}
          </Button>
        </div>
      </form>

      {removable ? <RemoveTenderItemForm tenderId={tenderId} itemId={item.id} /> : null}
    </div>
  );
}

function RemoveTenderItemForm({
  tenderId,
  itemId,
}: {
  tenderId: string;
  itemId: string;
}) {
  const t = useTranslations("tenders");
  const [state, formAction, isPending] = useActionState(
    removeTenderItemAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="itemId" value={itemId} />

      <TenderProblemNotice error={state.error} />

      <div>
        <Button type="submit" variant="destructive" disabled={isPending} className="h-11">
          {t("item.remove")}
        </Button>
      </div>
    </form>
  );
}

/** A blank Item appended to a Tender that already exists. */
export function AddTenderItemForm({ tenderId }: { tenderId: string }) {
  const t = useTranslations("tenders");
  const [state, formAction, isPending] = useActionState(addTenderItemAction, initialState);

  return (
    <form
      action={formAction}
      className="border-border flex flex-col gap-3 rounded-lg border border-dashed p-4"
    >
      <input type="hidden" name="tenderId" value={tenderId} />

      <h3 className="text-sm font-medium">{t("item.add")}</h3>

      <TenderProblemNotice error={state.error} />
      {/* Nothing after a successful add, so the panel comes back blank for the next
          Item; the refused row, so it does not have to be typed again. */}
      <TenderItemInputs
        domId={`item-new-${tenderId}`}
        defaults={state.submitted?.items?.[0]}
      />

      <div>
        <Button type="submit" variant="outline" disabled={isPending} className="h-11">
          {isPending ? t("form.saving") : t("item.add")}
        </Button>
      </div>
    </form>
  );
}

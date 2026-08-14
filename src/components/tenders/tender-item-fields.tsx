"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TenderItemFields } from "@/lib/tenders/tenders";

/**
 * One Item's fields.
 *
 * The four inputs keep the same names wherever they appear, because the server action
 * reads repeated fields as parallel lists — the nth `itemProductName` belongs with the
 * nth `itemQuantity`. `domId` only keeps the label/input pairing unique on a page that
 * renders several of these.
 *
 * Nothing here is `required`. A Tender needs at least one Item and an Item needs a
 * quantity, but both rules live in one place on the server; enforcing them a second
 * time in the browser is what makes a blank spare row impossible to submit past.
 */
export function TenderItemInputs({
  domId,
  defaults,
}: {
  domId: string;
  defaults?: TenderItemFields;
}) {
  const t = useTranslations("tenders.item");

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${domId}-productName`}>{t("productName")}</Label>
          <Input
            id={`${domId}-productName`}
            name="itemProductName"
            defaultValue={defaults?.productName}
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${domId}-description`}>{t("description")}</Label>
          <Input
            id={`${domId}-description`}
            name="itemDescription"
            defaultValue={defaults?.description ?? ""}
            className="h-11"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${domId}-quantity`}>{t("quantity")}</Label>
          <Input
            id={`${domId}-quantity`}
            name="itemQuantity"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            defaultValue={defaults?.quantity}
            className="h-11"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${domId}-unit`}>{t("unit")}</Label>
          <Input
            id={`${domId}-unit`}
            name="itemUnit"
            defaultValue={defaults?.unit}
            placeholder={t("unitPlaceholder")}
            className="h-11"
          />
        </div>
      </div>
    </div>
  );
}

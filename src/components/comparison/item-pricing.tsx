"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";

import {
  setLandedCostAction,
  setSellingPriceAction,
  type PricingState,
} from "@/app/actions/comparison";
import { Input } from "@/components/ui/input";
import { marginOf } from "@/lib/comparison/pricing";
import type { SheetItem } from "@/lib/comparison/sheet";
// From the currency list rather than from `@/lib/quotes/quotes`, which re-exports it: this
// runs in the browser, and that module is `server-only`.
import { reportingCurrency } from "@/lib/fx/currencies";

/**
 * Pricing, inline in the Item's row: landed cost, selling price, and the Margin between
 * them — the four money cells of the comparison working sheet.
 *
 * **Margin computes live, in the browser, as the selling price is typed.** That is the
 * whole reason this is a client component. Somebody works out what to bid by moving the
 * selling price until the Margin looks right, and a figure that only appears after a
 * round trip turns that into eight round trips.
 *
 * **Nothing here stores a Margin.** It is the selling price less the landed cost, and
 * `marginOf` computes it the same way the totals bar and every dashboard figure do.
 *
 * **Writing a landed cost confirms it** (ADR-0014), so a Margin shown against a landed
 * cost the person has just edited is shown as a number rather than as provisional, before
 * the save lands — that is what the save is about to record, and it is the figure they
 * are watching as they type. Until they touch it, a pre-filled cost has had no shipping,
 * duty or handling added and the Margin says so instead of pretending to be final.
 *
 * Each field saves on its way out — blur, or Enter — rather than behind a Save button per
 * row, and each is its own form so that a page with no JavaScript still writes both.
 */
export function ItemPricing({
  tenderId,
  item,
}: {
  tenderId: string;
  item: SheetItem;
}) {
  const t = useTranslations("comparison");
  const [landedCost, setLandedCost] = useState(fieldValue(item.landedCostPerUnit));
  const [sellingPrice, setSellingPrice] = useState(
    fieldValue(item.sellingPricePerUnit),
  );
  const [stored, setStored] = useState(figuresOf(item));

  // The fields follow the server when the server's own figures move — which is what a
  // Landed Cost re-prefilled by a new Selected Quote is. Adjusted during the render
  // rather than by remounting the fields on a key: a save on one field re-draws this
  // whole row, and a remount would take the cursor out of the field somebody had just
  // tabbed into.
  const current = figuresOf(item);

  if (
    current.landedCost !== stored.landedCost ||
    current.sellingPrice !== stored.sellingPrice
  ) {
    setStored(current);

    // Each figure follows its own: a landed cost re-prefilled by a new Selected Quote
    // must not throw away a selling price somebody is still typing beside it.
    if (current.landedCost !== stored.landedCost) {
      setLandedCost(fieldValue(item.landedCostPerUnit));
    }

    if (current.sellingPrice !== stored.sellingPrice) {
      setSellingPrice(fieldValue(item.sellingPricePerUnit));
    }
  }

  // Hand-edited here but not yet saved. The save will stamp `landed_cost_confirmed_at`,
  // so the Margin is allowed to be a number now rather than a beat later.
  const editedHere = landedCost !== fieldValue(item.landedCostPerUnit);
  const margin = marginOf({
    quantity: item.quantity,
    landedCostPerUnit: typedAmount(landedCost),
    landedCostConfirmed: editedHere || item.landedCostConfirmedAt !== null,
    sellingPricePerUnit: typedAmount(sellingPrice),
  });

  const identity = (
    <>
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="tenderItemId" value={item.id} />
    </>
  );

  return (
    <>
      <td className="border-border border-t px-2 py-3 align-top">
        <PriceField
          action={setLandedCostAction}
          name="landedCostPerUnit"
          label={t("pricing.landedCost", { item: item.productName })}
          // What this field is for, and what saving it does. On the field rather than
          // under it, and repeated into the accessible name the way the quote table
          // carries its frozen rate: the money columns have no width to spare.
          hint={t("pricing.hint")}
          value={landedCost}
          storedValue={fieldValue(item.landedCostPerUnit)}
          onValueChange={setLandedCost}
        >
          {identity}
        </PriceField>
      </td>

      <td className="border-border border-t px-2 py-3 align-top">
        <PriceField
          action={setSellingPriceAction}
          name="sellingPricePerUnit"
          label={t("pricing.selling", { item: item.productName })}
          value={sellingPrice}
          storedValue={fieldValue(item.sellingPricePerUnit)}
          onValueChange={setSellingPrice}
        >
          {identity}
        </PriceField>
      </td>

      <td className="border-border border-t px-2 py-3 text-right align-top tabular-nums">
        <Margin value={margin?.perUnit ?? null} provisional={margin?.provisional ?? false} />
      </td>
      <td className="border-border border-t px-2 py-3 text-right align-top tabular-nums">
        <Margin value={margin?.onLine ?? null} provisional={margin?.provisional ?? false} />
      </td>
    </>
  );
}

/**
 * One money field that saves itself.
 *
 * The submit button is there for the keyboard and for a browser running no JavaScript at
 * all — Enter in a lone text field only submits a form that has one. With JavaScript, the
 * field submits on blur, and only when the digits actually changed: tabbing across a row
 * of prices to read them must not write four rows back unchanged.
 */
function PriceField({
  action,
  name,
  label,
  hint,
  value,
  storedValue,
  onValueChange,
  children,
}: {
  action: (previous: PricingState, formData: FormData) => Promise<PricingState>;
  name: string;
  label: string;
  /** Said on hover and to a screen reader, never given a line of the row's width. */
  hint?: string;
  value: string;
  /** What the row was rendered with — what "changed" is measured against. */
  storedValue: string;
  onValueChange: (value: string) => void;
  /** The hidden fields naming the Item this figure belongs to. */
  children: ReactNode;
}) {
  const t = useTranslations("comparison.pricing");
  const [state, formAction, isPending] = useActionState(action, initialState);
  const form = useRef<HTMLFormElement>(null);

  return (
    <form ref={form} action={formAction} className="flex flex-col items-end gap-1">
      {children}

      <Input
        type="number"
        // `any`, not a two-decimal step: the column holds four, and a browser refusing
        // to submit 620.1234 as "invalid" would be refusing a real landed cost.
        step="any"
        min="0"
        inputMode="decimal"
        name={name}
        aria-label={hint === undefined ? label : `${label}. ${hint}`}
        title={hint}
        aria-invalid={state.error !== undefined}
        value={value}
        // `readOnly` rather than `disabled` for the beat the write takes: a disabled
        // field loses the focus somebody put there by pressing Enter in it.
        readOnly={isPending}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={() => {
          // Leaving a field alone is not an act. Tabbing across a row of prices to read
          // them must not write four rows back unchanged — on the landed cost, that
          // would confirm a cost nobody had looked at.
          //
          // Pressing Enter is an act, and it submits whatever is in the field, changed
          // or not: that is how a Landed Cost whose freight is genuinely zero gets
          // confirmed at the figure it was pre-filled with (ADR-0014).
          if (value === storedValue) return;

          form.current?.requestSubmit();
        }}
        className="h-11 text-right tabular-nums"
      />

      <button type="submit" className="sr-only">
        {isPending ? t("saving") : t("save")}
      </button>

      {state.error === undefined ? null : (
        <p role="alert" className="text-destructive text-xs">
          {t(`error.${state.error}`)}
        </p>
      )}
    </form>
  );
}

/**
 * Margin, or the honest absence of one.
 *
 * A Margin derived from an **Unconfirmed** Landed Cost — one still sitting at its
 * pre-filled value, with nothing added for shipping, duty or handling — is understated in
 * cost and overstated in profit, so it renders as provisional rather than as a number.
 * Nothing is blocked and nobody is nagged; the figure simply stops pretending to be final.
 */
function Margin({ value, provisional }: { value: number | null; provisional: boolean }) {
  const t = useTranslations("comparison");
  const format = useFormatter();

  if (value === null) return <span className="text-muted-foreground">{emDash}</span>;

  if (provisional) {
    return <span className="text-muted-foreground text-xs">{t("provisional")}</span>;
  }

  return (
    <span className={value < 0 ? "text-destructive font-medium" : "font-medium"}>
      {format.number(value, { style: "currency", currency: reportingCurrency })}
    </span>
  );
}

const initialState: PricingState = {};

const emDash = "—";

/** The two figures as the server last sent them, for spotting when they move. */
function figuresOf(item: SheetItem): { landedCost: number | null; sellingPrice: number | null } {
  return {
    landedCost: item.landedCostPerUnit,
    sellingPrice: item.sellingPricePerUnit,
  };
}

/** A stored amount as the field shows it, and an empty field for one that is not there. */
function fieldValue(amount: number | null): string {
  return amount === null ? "" : String(amount);
}

/** What is in the field, as a number — or null for a field somebody has emptied. */
function typedAmount(value: string): number | null {
  if (value.trim() === "") return null;

  const amount = Number(value);

  // A half-typed "-" or "1e" is not a cost. Showing no Margin beats showing one built
  // out of `NaN`, and the field is a beat away from holding a real number anyway.
  return Number.isFinite(amount) ? amount : null;
}

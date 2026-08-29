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
 * them.
 *
 * **Margin computes live, in the browser, as the selling price is typed.** That is the
 * whole reason this is a client component. Somebody works out what to bid by moving the
 * selling price until the Margin looks right, and a figure that only appears after a
 * round trip turns that into eight round trips.
 *
 * **The Margin sits below the two fields, at every width.** ADR-0009 puts it there for a
 * phone — the numeric keyboard covers the bottom of the screen, so a figure to the right
 * of the fields would be a figure nobody watching themselves type can see — and it stays
 * there at a desk rather than becoming a second arrangement to keep correct. The block is
 * written once and has no breakpoint of its own.
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
    <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <PriceField
          action={setLandedCostAction}
          name="landedCostPerUnit"
          caption={t("label.landedCost")}
          // The cost is still sitting at whatever the Selected Quote pre-filled, with
          // nothing added for shipping, duty or handling — so it is marked where it is
          // read, not only inferred from the Margin beneath it. Writing a Landed Cost is
          // what confirms it (ADR-0014), so this clears the moment somebody saves one.
          unconfirmed={!editedHere && item.landedCostConfirmedAt === null}
          label={t("pricing.landedCost", { item: item.productName })}
          // What this field is for, and what saving it does. On the field rather than
          // under it, and repeated into the accessible name the way the quote table
          // carries its frozen rate: the caption above it has one line and no room.
          hint={t("pricing.hint")}
          value={landedCost}
          storedValue={fieldValue(item.landedCostPerUnit)}
          onValueChange={setLandedCost}
        >
          {identity}
        </PriceField>

        <PriceField
          action={setSellingPriceAction}
          name="sellingPricePerUnit"
          caption={t("label.selling")}
          label={t("pricing.selling", { item: item.productName })}
          value={sellingPrice}
          storedValue={fieldValue(item.sellingPricePerUnit)}
          onValueChange={setSellingPrice}
        >
          {identity}
        </PriceField>
      </div>

      {/* Below the fields, never beside them — see the note at the top. */}
      <dl className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <MarginFigure
          label={t("label.marginPerUnit")}
          value={margin?.perUnit ?? null}
          provisional={margin?.provisional ?? false}
        />
        <MarginFigure
          label={t("label.marginOnLine")}
          value={margin?.onLine ?? null}
          provisional={margin?.provisional ?? false}
        />
      </dl>
    </div>
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
  caption,
  label,
  hint,
  unconfirmed = false,
  value,
  storedValue,
  onValueChange,
  children,
}: {
  action: (previous: PricingState, formData: FormData) => Promise<PricingState>;
  name: string;
  /**
   * What the field is called, above it. The Item's blocks wrap rather than sitting under
   * a header strip, so each field says what it is where it is — the accessible name below
   * opens with the same words and then goes on to say which Item it belongs to, which
   * four fields all reading "Landed cost / unit" could not.
   */
  caption: string;
  label: string;
  /** Said on hover and to a screen reader, never given a line of the row's width. */
  hint?: string;
  /** Marks the figure as not yet confirmed by anybody. Only the Landed Cost can be. */
  unconfirmed?: boolean;
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
    <form ref={form} action={formAction} className="flex min-w-0 flex-col gap-1">
      {children}

      <span className="text-muted-foreground flex flex-wrap items-baseline gap-1.5 text-xs">
        <span aria-hidden>{caption}</span>
        {unconfirmed ? (
          // In words as well as in flag, so the marking survives greyscale and sunlight.
          // Not `aria-hidden`: this one is a fact about the figure, not a repeat of the
          // field's own name, and a screen reader that skipped it would read a pre-filled
          // cost as a real one.
          <span className="bg-flag-wash text-flag-ink rounded px-1.5 py-0.5 text-[0.7rem] font-medium">
            {t("unconfirmed")}
          </span>
        ) : null}
      </span>

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

/** One of the two Margins, with the name it is read by beside it. */
function MarginFigure({
  label,
  value,
  provisional,
}: {
  label: string;
  value: number | null;
  provisional: boolean;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>
        <Margin value={value} provisional={provisional} />
      </dd>
    </div>
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

  // Flag, not ink: provisional is a property of the figure — what this Margin *is* —
  // rather than a state of the Tender or a thing that has gone wrong.
  if (provisional) {
    return <span className="text-flag-ink text-xs font-medium">{t("provisional")}</span>;
  }

  // **A negative Margin is never rendered in red**, nor in any alarm-toned treatment.
  // In Chinese financial convention red is up and green is down — the inverse of the
  // Western reading — so a red negative Margin is read as a *gain* by half the people
  // using this daily. Keeping alarm to deadlines sidesteps the inversion rather than
  // picking a side of it, which is the only move available in an app that ships `en` and
  // `zh-Hans` from one component tree (ADR-0019). The minus sign the formatter puts in
  // front of the figure is the copy of the meaning, and it inverts for nobody.
  return (
    <span className="money text-base font-medium">
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

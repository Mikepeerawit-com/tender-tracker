"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import {
  clearSubmissionAction,
  recordSubmissionAction,
  setItemOutcomeAction,
  type TenderFormState,
} from "@/app/actions/tenders";
import { TenderProblemNotice } from "@/components/tenders/tender-problem";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { itemOutcomes, type ItemOutcome } from "@/lib/tenders/outcome";

/**
 * The two things a person records about how a Tender ended: that the Bid went out, and
 * what each Item came to.
 *
 * Both are facts rather than plans, and both are revisable. Nothing here confirms
 * anything before writing it — a wrong Outcome is corrected by picking another, and a
 * submission recorded in error is taken back with the button beside it.
 */

const initialState: TenderFormState = {};

/** "The Bid went out." One button, and the date it stamps comes from the server. */
export function RecordSubmissionButton({ tenderId }: { tenderId: string }) {
  const t = useTranslations("tenders.outcome");

  return (
    <SubmissionForm
      tenderId={tenderId}
      action={recordSubmissionAction}
      label={t("record")}
      pendingLabel={t("recording")}
    />
  );
}

/**
 * "It did not, after all."
 *
 * The undo is load-bearing, not a nicety. No column says a submission was missed — its
 * absence is what says so (ADR-0003) — so a submission recorded against the wrong Tender
 * quietly takes that Tender out of the one block on the list that exists to be loud.
 */
export function ClearSubmissionButton({ tenderId }: { tenderId: string }) {
  const t = useTranslations("tenders.outcome");

  return (
    <SubmissionForm
      tenderId={tenderId}
      action={clearSubmissionAction}
      label={t("clear")}
      pendingLabel={t("clearing")}
      // Quieter than the button that records one: taking the submission off is the rarer
      // act and the more destructive, and should not sit there inviting a press.
      variant="ghost"
    />
  );
}

/**
 * The two of them are one form: a Tender id, a button, and whatever it refused.
 *
 * Each carries its own pending word rather than sharing one, because the two acts are
 * opposites and *Recording…* over the button that takes a submission back would say the
 * wrong thing at the one moment somebody is watching to see whether it worked (#144).
 */
function SubmissionForm({
  tenderId,
  action,
  label,
  pendingLabel,
  variant = "default",
}: {
  tenderId: string;
  action: (previous: TenderFormState, formData: FormData) => Promise<TenderFormState>;
  label: string;
  /** What it says for as long as the write is in flight. */
  pendingLabel: string;
  variant?: "default" | "ghost";
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="tenderId" value={tenderId} />

      <Button type="submit" variant={variant} disabled={isPending} className="h-11">
        {isPending ? pendingLabel : label}
      </Button>

      <TenderProblemNotice error={state.error} />
    </form>
  );
}

/**
 * How one Item ended, as a picker that saves itself.
 *
 * The four stored values and "not decided yet", and nothing else: `partial` is a
 * Tender-level reading of these rows and is not on offer here, because there is no row
 * for it to be written to (ADR-0001).
 *
 * Per Item, and that is the whole point — a client awarding the gloves to us and the
 * catheters to a competitor is ordinary, and one control on the Tender could not say so.
 */
export function ItemOutcomePicker({
  tenderId,
  itemId,
  productName,
  outcome,
}: {
  tenderId: string;
  itemId: string;
  productName: string;
  outcome: ItemOutcome | null;
}) {
  const t = useTranslations("tenders.outcome");
  const [state, formAction, isPending] = useActionState(
    setItemOutcomeAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="itemId" value={itemId} />

      <NativeSelect
        // Keyed on the stored Outcome, so the control is rebuilt whenever the server's
        // answer moves. React resets a form after every action, and a reset puts a
        // `<select>` back to the option it was *mounted* with — which is the Outcome as
        // it stood before the save. Rebuilding it is what makes the reset land on the new
        // value instead of undoing it, whichever order the two arrive in. The cost is the
        // focus, which a rebuilt control cannot keep; picking is a finished act, unlike
        // the half-typed prices next door, which is why `ItemPricing` does the opposite.
        key={outcome ?? ""}
        name="outcome"
        aria-label={t("pick", { item: productName })}
        className="h-11 w-56"
        // Never disabled for the beat the write takes: a disabled control loses the focus
        // of somebody working down the Items from the keyboard, and picking again before
        // the first save lands simply writes the second answer over it. Since #144 this is
        // the app's one answer for a `<select>` that submits itself, rather than this
        // control's alone — `ReferenceImageGallery`'s assign-to picker used to disable and
        // now agrees.
        defaultValue={outcome ?? ""}
        // Two taps rather than three. A Save beside the picker is one more thing to miss
        // on a phone, and an Outcome has no draft state worth keeping — it is either
        // right or corrected by picking again.
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">{t("undecided")}</option>
        {itemOutcomes.map((value) => (
          <option key={value} value={value}>
            {t(`value.${value}`)}
          </option>
        ))}
      </NativeSelect>

      {/* For a browser running no JavaScript, where changing a select submits nothing.
          Out of the way of everybody else, the way the price fields do it. */}
      <button type="submit" className="sr-only">
        {isPending ? t("saving") : t("save")}
      </button>

      <TenderProblemNotice error={state.error} />
    </form>
  );
}

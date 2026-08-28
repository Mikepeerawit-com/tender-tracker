"use client";

import { useActionState, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { createQuoteAction, type QuoteFormState } from "@/app/actions/quotes";
import { useImageUpload } from "@/components/images/use-image-upload";
import { QuotePhotoPicker } from "@/components/quotes/quote-photo-picker";
import { quotePhotoDestination } from "@/components/quotes/quote-photo-uploads";
import { QuoteProblemNotice } from "@/components/quotes/quote-problem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { currencyOptions } from "@/lib/fx/currencies";
import { maxImagesAtOnce, type ImageProblem } from "@/lib/images/images";
// From `@/lib/quotes/quote-form` rather than from `@/lib/quotes/quotes`, which
// re-exports it: this runs in the browser, and that module is `server-only`.
import { matchTypes, type MatchType, type SubmittedQuote } from "@/lib/quotes/quote-form";
import { saveQuoteThenPhotos } from "@/lib/quotes/quote-with-photos";

/**
 * Screen 4: what the supplier said, written down before it is forgotten — price and
 * photographs together, in one pass.
 *
 * The shape of this form is the ticket's whole argument. An Assignee is off the phone
 * holding a price **in the currency the supplier quoted, in the unit the supplier
 * quoted**, and the one thing they must not have to do is arithmetic. So currency and
 * unit are fields rather than conversions, the rate is frozen behind the scenes at the
 * moment of saving, and nothing on this screen can fail because a rate service in
 * Frankfurt is down.
 *
 * Everything is uncontrolled and re-seeded from `state.submitted` on every submit, which
 * is what makes a refusal keep the typed price. React resets a form on each
 * function-action submit, refused ones included, so a refusal that carried back only a
 * reason would empty the form it is complaining about — and this one is filled in once,
 * on a phone, holding a number the supplier may not repeat today.
 *
 * ## The photos are held here until there is a Quote to hang them on
 *
 * Picking a file does not upload it. The files sit in `held` until submit, and then the
 * price is written *first* and the photos are uploaded against the id that comes back —
 * an order enforced in `saveQuoteThenPhotos`, where it can be tested without a screen.
 * The signing function refuses an id no Quote answers to, and is not relaxed to make this
 * work; the browser simply never asks until there is one.
 *
 * Held files are state of the same kind as `matchType`, and follow the same rule (#37):
 * the component does not remount on a refusal, so what is held is exactly what was
 * picked, and it is still picked when the corrected form is submitted again.
 *
 * ## What a partial run says
 *
 * A run ending with the price saved and a photo missing is recoverable and is reported as
 * that: the Quote is kept, the photos that did not make it are named, and there is a
 * button to try those and only those again — aimed at the Quote that exists, so a retry
 * cannot write a second one. The offer outlives the submits after it, for the reason
 * {@link OutstandingPhotos} gives. The price is the part that cannot be got again once the
 * supplier has rung off; a photo can also be added later from the Quote's own row, which
 * is a path that stays for its own reasons.
 *
 * ## The cost, stated
 *
 * `useActionState` is given a function that runs in the browser rather than the server
 * action itself, because the sequencing — write, then upload against what was written —
 * only exists on the client. That gives up progressive enhancement on this form. It is
 * not a real loss here: holding files in the browser is the feature, and the screen is
 * opened from the WeCom in-app webview with scripting on.
 */
const initialState: QuoteFormState = {};

/** One picked file, before anything has been written down. */
type HeldQuotePhoto = { key: string; file: File };

/**
 * A Quote that *was* written, and the photos of it that did not make it.
 *
 * A list of these rather than one, because they outlive the submit that produced them. An
 * Assignee rings four suppliers in a row on this screen; the second Quote saving cleanly
 * must not quietly take away the retry offered for the first, whose photographs may exist
 * nowhere else — a picture taken through a `capture` input is not necessarily in the
 * camera roll afterwards.
 */
type OutstandingPhotos = {
  quoteId: string;
  /** Which supplier's Quote, so several of these can be told apart. */
  supplierName: string;
  photos: HeldQuotePhoto[];
  /** Why they did not land, as it was at the time. */
  reason: ImageProblem;
};

export function QuoteForm({
  tenderId,
  tenderItemId,
  defaults,
}: {
  tenderId: string;
  tenderItemId: string;
  /** A blank form with the Item's unit and today's date already in it. */
  defaults: SubmittedQuote;
}) {
  const t = useTranslations("quotes");
  // The same sentences `ImageProblemNotice` renders, without its box: here they are one
  // line of a larger notice rather than a notice of their own.
  const reason = useTranslations("images.error");
  const { progress, busy, upload } = useImageUpload();

  // Picked, not yet uploaded, and belonging to the Quote this form is about to write.
  const [held, setHeld] = useState<HeldQuotePhoto[]>([]);

  /** Unique within the held list, which is all a React key has to be. */
  const nextKey = useRef(0);

  // Refused at the picker, before anything is held. Only `too_many` reaches it today, and
  // the reason it is said here rather than by the uploader is that by the time the
  // uploader could say it the Quote is written and the photos are stranded against it —
  // where the only offer is a retry, and a retry of eleven photos is refused for being
  // eleven photos every time. Said at the pick, it is one the person can act on.
  const [pickProblem, setPickProblem] = useState<ImageProblem | null>(null);

  // Kept apart from `held` on purpose: these belong to Quotes that already exist, so they
  // must not ride along on the next supplier's submit, and their retry must aim at the
  // Quote it belongs to rather than mint another.
  const [outstanding, setOutstanding] = useState<OutstandingPhotos[]>([]);

  // The one piece of state on the form that decides what else is on the form. It survives
  // a refusal without being told to: the component does not remount, so what is held here
  // is exactly what was posted. Seeded from `defaults` rather than from a refused
  // submit's values, which is the same thing — `useState` reads its initialiser only on
  // the mount, when nothing has been submitted yet.
  const [matchType, setMatchType] = useState<MatchType>(
    defaults.matchType === "alternative" ? "alternative" : "exact",
  );

  /**
   * Hold what was just picked, unless it would take the batch past what one upload may
   * carry. Additive: the camera hands over one photo at a time, and four calls to it are
   * four photos of the same box.
   */
  function pick(files: File[]) {
    if (held.length + files.length > maxImagesAtOnce) {
      setPickProblem("too_many");
      return;
    }

    setPickProblem(null);
    setHeld((already) => [
      ...already,
      ...files.map((file) => ({ key: `held-${nextKey.current++}`, file })),
    ]);
  }

  async function saveQuote(
    previous: QuoteFormState,
    formData: FormData,
  ): Promise<QuoteFormState> {
    const { state: written, uploaded } = await saveQuoteThenPhotos({
      photos: held.map((photo) => photo.file),
      save: () => createQuoteAction(previous, formData),
      upload: (quoteId, files) =>
        upload(files, quotePhotoDestination({ quoteId, tenderId })),
    });

    // Refused. The photos stay held, unsent, and go up with the corrected resubmit.
    if (uploaded === null) return written;

    // Written. Whatever was held is that Quote's now — either uploaded, or outstanding
    // against it — so the form starts empty for the next supplier, which is what an
    // Assignee ringing four of them in a row needs.
    setHeld([]);
    setPickProblem(null);
    setMatchType("exact");

    // Appended, never replacing: an earlier Quote's outstanding photos are still
    // outstanding, and this submit knows nothing about them.
    if (uploaded.failed.length > 0) {
      setOutstanding((already) => [
        ...already,
        {
          quoteId: uploaded.quoteId,
          supplierName: String(formData.get("supplierName") ?? "").trim(),
          photos: held.filter((photo) => uploaded.failed.includes(photo.file)),
          reason: uploaded.error ?? "failed",
        },
      ]);
    }

    return written;
  }

  const [state, formAction, isPending] = useActionState(saveQuote, initialState);

  const fields = state.submitted ?? defaults;

  /** The outstanding photos of one Quote already written, and only those. */
  async function retry(run: OutstandingPhotos) {
    const outcome = await upload(
      run.photos.map((photo) => photo.file),
      quotePhotoDestination({ quoteId: run.quoteId, tenderId }),
    );

    setOutstanding((already) =>
      already.flatMap((candidate) => {
        if (candidate.quoteId !== run.quoteId) return [candidate];
        if (outcome.failed.length === 0) return [];

        return [
          {
            ...candidate,
            photos: candidate.photos.filter((photo) =>
              outcome.failed.includes(photo.file),
            ),
            reason: outcome.error ?? "failed",
          },
        ];
      }),
    );
  }

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="tenderId" value={tenderId} />
        <input type="hidden" name="tenderItemId" value={tenderItemId} />

        <QuoteProblemNotice error={state.error} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="supplierName" label={t("supplier")} hint={t("supplierHint")}>
            <Input
              id="supplierName"
              name="supplierName"
              defaultValue={fields.supplierName}
              autoComplete="off"
              className="h-11"
            />
          </Field>

          <Field id="quotedAt" label={t("quotedAt")} hint={t("quotedAtHint")}>
            <Input
              id="quotedAt"
              name="quotedAt"
              type="date"
              defaultValue={fields.quotedAt}
              className="h-11"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="unitPrice" label={t("unitPrice")}>
            <Input
              id="unitPrice"
              name="unitPrice"
              type="number"
              // `decimal` rather than `numeric`: a price has a decimal point in it, and the
              // numeric keypad on iOS does not offer one.
              inputMode="decimal"
              min="0"
              step="any"
              defaultValue={fields.unitPrice}
              className="h-11"
            />
          </Field>

          <Field id="currency" label={t("currency")}>
            <NativeSelect
              id="currency"
              name="currency"
              defaultValue={fields.currency}
              className="h-11"
            >
              {currencyOptions.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field id="quotedUnit" label={t("quotedUnit")} hint={t("quotedUnitHint")}>
            <Input
              id="quotedUnit"
              name="quotedUnit"
              defaultValue={fields.quotedUnit}
              className="h-11"
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("matchType.label")}</legend>
          <p className="text-muted-foreground text-xs">{t("matchType.hint")}</p>

          <div className="flex flex-wrap gap-2">
            {matchTypes.map((option) => (
              <label
                key={option}
                className="border-input has-checked:border-ring has-checked:bg-muted focus-within:ring-ring/50 flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm focus-within:ring-3"
              >
                <input
                  type="radio"
                  name="matchType"
                  value={option}
                  checked={matchType === option}
                  onChange={() => setMatchType(option)}
                />
                {t(`matchType.${option}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Revealed, and required once revealed. An Alternative that does not say what was
            actually offered is the one Quote nobody can judge: the comparison view's
            QUOTED PRODUCT column is where a reviewer finds out they are being shown a
            different product, and it reads this column and nothing else. */}
        {matchType === "alternative" ? (
          <Field
            id="alternativeProductName"
            label={t("alternativeProductName")}
            hint={t("alternativeProductHint")}
          >
            <Input
              id="alternativeProductName"
              name="alternativeProductName"
              required
              defaultValue={fields.alternativeProductName}
              className="h-11"
            />
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="leadTimeDays" label={t("leadTimeDays")} hint={t("leadTimeHint")}>
            <Input
              id="leadTimeDays"
              name="leadTimeDays"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              defaultValue={fields.leadTimeDays}
              className="h-11"
            />
          </Field>

          <Field id="detailNotes" label={t("detailNotes")} hint={t("detailNotesHint")}>
            <Textarea
              id="detailNotes"
              name="detailNotes"
              defaultValue={fields.detailNotes}
            />
          </Field>
        </div>

        {/* The file inputs carry no `name`, so nothing about a photo is posted with the
            price. They are held in this component and uploaded afterwards, against the id
            the submit gives back. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("photos.attach")}</legend>
          <p className="text-muted-foreground text-xs">{t("photos.attachHint")}</p>

          <div className="flex flex-wrap items-center gap-2">
            <QuotePhotoPicker disabled={isPending} onPicked={pick} />
          </div>

          {pickProblem ? (
            <p role="alert" className="text-destructive text-sm break-words">
              {reason(pickProblem)}
            </p>
          ) : null}

          {held.length > 0 ? (
            <>
              <p className="text-muted-foreground text-sm">
                {t("photos.waiting", { count: held.length })}
              </p>

              {/* Names rather than thumbnails, unlike the gallery on a saved Quote. These
                  were picked seconds ago by the person looking at them, in the order they
                  were taken; a Quote's stored photos may be days old and from three
                  different people, which is why that list has pictures in it. */}
              <ul className="flex flex-col gap-1">
                {held.map((photo) => (
                  <li
                    key={photo.key}
                    className="border-border flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5"
                  >
                    <span className="min-w-0 text-sm break-all">{photo.file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      aria-label={t("photos.removeHeld", { name: photo.file.name })}
                      onClick={() => {
                        setPickProblem(null);
                        setHeld((already) =>
                          already.filter((candidate) => candidate.key !== photo.key),
                        );
                      }}
                    >
                      {t("photos.remove")}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {progress ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("photos.uploading", { done: progress.done, total: progress.total })}
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isPending} className="h-11">
            {isPending ? t("saving") : t("save")}
          </Button>

          {/* Said here rather than by landing somebody on the new row, because the row is
              above the fold they are already past and this is where the thumb is. */}
          {state.quoteId ? (
            <span role="status" className="text-muted-foreground text-sm">
              {t("saved")}
            </span>
          ) : null}
        </div>
      </form>

      {/* Outside the form: these are about Quotes already written, not about the one being
          typed next, and nothing here may post that form.

          The reason sits inside each block rather than on its own, which is the whole
          difference between two notices and one story. `images.error.failed` reads "that
          could not be saved" — true of the photos, and read as the price by anybody who
          met it a line under a form they had just submitted a price on. */}
      {outstanding.map((run) => (
        <div
          key={run.quoteId}
          className="border-destructive/40 bg-destructive/10 flex flex-col items-start gap-2 rounded-lg border px-3 py-2"
        >
          <p role="alert" className="text-sm break-words">
            {t("photos.savedWithout", {
              supplier: run.supplierName,
              names: run.photos.map((photo) => photo.file.name).join(", "),
            })}
          </p>

          <p className="text-destructive text-sm break-words">{reason(run.reason)}</p>

          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void retry(run)}
          >
            {t("photos.retry")}
          </Button>
        </div>
      ))}

    </>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

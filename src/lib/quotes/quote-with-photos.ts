import type { UploadOutcome } from "@/lib/images/images";

import type { QuoteFormState } from "./quote-form";

/**
 * One supplier call, one pass through the screen: the price and the photos together.
 *
 * ## Why this is a module and not four lines in the form
 *
 * The rule it enforces is the one rule of this feature that has no visible symptom when
 * it is broken. A Quote written with no photo is a call somebody can finish later. A
 * photo written with no Quote is an object sitting in a folder named after an id that no
 * row answers to — invisible to every screen, unreachable by every listing, and still
 * billed for. Nothing on the form would look wrong; the refusal notice would appear
 * exactly as it should.
 *
 * So the ordering lives here, where a test can drive it with a refusing `save` and assert
 * that `upload` was never reached, rather than in a component where the same fact can
 * only be inferred from what rendered.
 *
 * ## The other half is on the server
 *
 * `signQuotePhotoUploads` refuses an id nothing answers to, and verifies the Quote is
 * visible under RLS before it mints a single key. That is not relaxed and this does not
 * replace it: this says the browser never asks, that says asking would not work. Either
 * alone would be a guarantee resting on one side of a network.
 *
 * ## A partial run is an ending, not a failure
 *
 * The price is the part that cannot be got again — the supplier has rung off, and a
 * number is not necessarily repeated an hour later. Photos can be added to the Quote
 * afterwards from its own row, which is a path that exists for its own reasons and is not
 * going away. So a run that ends with the Quote written and two of three photos up is
 * reported as what it is: a saved Quote, and two photos to try again.
 */

/** What happened to the photos of the Quote just written. */
export type QuotePhotoRun = UploadOutcome & {
  /**
   * The Quote they belong to, carried out so a retry aims at the Quote that exists
   * rather than writing a second one.
   */
  quoteId: string;
};

/**
 * One pass through the form: what to show, and what became of the photos.
 *
 * Not named for the Quote — `savedQuote()` in `./quote-form` already means the state a
 * successful write returns, and this is the whole run around it.
 */
export type QuoteSaveRun = {
  /** What the form shows: the refusal and the typed values, or the id that was written. */
  state: QuoteFormState;
  /**
   * Null when the Quote was refused — the one case in which no photo may be signed,
   * uploaded or recorded.
   */
  uploaded: QuotePhotoRun | null;
};

export async function saveQuoteThenPhotos({
  photos,
  save,
  upload,
}: {
  /** The files held in the browser since they were picked, in the order they were picked. */
  photos: File[];
  save: () => Promise<QuoteFormState>;
  upload: (quoteId: string, files: File[]) => Promise<UploadOutcome>;
}): Promise<QuoteSaveRun> {
  const state = await save();

  // Refused — for a price of zero, for an unreachable rate, for not being an Assignee.
  // The photos stay held in the browser, unsigned and unsent, and come back attached when
  // the problem is corrected and the form is submitted again.
  if (state.quoteId === undefined) return { state, uploaded: null };

  // Nothing picked, which is the ordinary desk case: a supplier emailed a price and
  // nobody photographed anything. Signing is a round trip per picture and an empty batch
  // is refused as `no_images` anyway, so it is not asked for.
  if (photos.length === 0) {
    return { state, uploaded: { quoteId: state.quoteId, failed: [], error: null } };
  }

  return {
    state,
    uploaded: { quoteId: state.quoteId, ...(await upload(state.quoteId, photos)) },
  };
}

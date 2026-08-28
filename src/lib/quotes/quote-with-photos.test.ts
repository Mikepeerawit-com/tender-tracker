import { describe, expect, it, vi } from "vitest";

import type { UploadOutcome } from "@/lib/images/images";

import { refusedQuote, savedQuote, submittedQuote } from "./quote-form";
import { saveQuoteThenPhotos } from "./quote-with-photos";

/**
 * The order the whole one-pass form turns on: the Quote first, its photos second, and no
 * photo touched at all when the Quote was refused.
 *
 * Asserted here rather than through the form, because through the form it is only ever
 * inferred. The interesting run is the one where the server says no — nothing renders
 * differently, nothing is thrown, and the only observable fact is that Storage was never
 * asked for a key. A UI test watching a refusal notice appear would pass just as happily
 * against a version that had already signed three uploads against a Quote id of
 * `undefined`.
 *
 * The other half of the same guarantee is on the server, where `signQuotePhotoUploads`
 * refuses an id no row answers to. Both are needed: this one says the client never asks,
 * that one says asking would not work.
 */

function aPhoto(name: string): File {
  return new File([new Uint8Array([0xff])], name, { type: "image/jpeg" });
}

const landed: UploadOutcome = { failed: [], error: null };

/** The form as it was typed, which a refusal has to give back whole. */
function typed(): FormData {
  const formData = new FormData();

  formData.append("supplierName", "Ace Medical");
  formData.append("unitPrice", "118");

  return formData;
}

describe("saving a Quote and its photos in one pass", () => {
  it("signs nothing, uploads nothing and records nothing when the Quote is refused", async () => {
    // The run that must be impossible. A photo written against a Quote that was never
    // written is an object in a folder keyed by an id nothing answers to — invisible to
    // every screen, and billed for.
    const upload = vi.fn<(quoteId: string, files: File[]) => Promise<UploadOutcome>>();

    const result = await saveQuoteThenPhotos({
      photos: [aPhoto("ace-gloves.jpg")],
      save: async () => refusedQuote("invalid_price", submittedQuote(typed())),
      upload,
    });

    expect(upload).not.toHaveBeenCalled();
    expect(result.uploaded).toBeNull();
    // And the typed values come back with the refusal, photos or no photos.
    expect(result.state.error).toBe("invalid_price");
    expect(result.state.submitted?.supplierName).toBe("Ace Medical");
  });

  it("uploads the held photos against the Quote that was just written", async () => {
    const photos = [aPhoto("first.jpg"), aPhoto("second.jpg")];
    const upload = vi.fn(async () => landed);

    const result = await saveQuoteThenPhotos({
      photos,
      save: async () => savedQuote("quote-written"),
      upload,
    });

    expect(upload).toHaveBeenCalledExactlyOnceWith("quote-written", photos);
    expect(result.uploaded).toEqual({ quoteId: "quote-written", failed: [], error: null });
  });

  it("asks Storage for nothing when no photo was picked", async () => {
    // Signing is a round trip per picture. A Quote entered from a desk, off an email,
    // should not pay for one — and an empty batch is refused as `no_images` anyway.
    const upload = vi.fn(async () => landed);

    const result = await saveQuoteThenPhotos({
      photos: [],
      save: async () => savedQuote("quote-written"),
      upload,
    });

    expect(upload).not.toHaveBeenCalled();
    expect(result.uploaded).toEqual({ quoteId: "quote-written", failed: [], error: null });
  });

  it("keeps the Quote and names the photos that did not make it", async () => {
    // The recoverable ending, and the one that must not be dressed up as a failed Quote:
    // the price is the part that cannot be obtained again once the supplier has rung off.
    const stayed = aPhoto("second.jpg");
    const photos = [aPhoto("first.jpg"), stayed];

    const result = await saveQuoteThenPhotos({
      photos,
      save: async () => savedQuote("quote-written"),
      upload: async () => ({ failed: [stayed], error: "failed" }),
    });

    expect(result.state.error).toBeUndefined();
    expect(result.state.quoteId).toBe("quote-written");
    expect(result.uploaded).toEqual({
      quoteId: "quote-written",
      failed: [stayed],
      error: "failed",
    });
  });
});

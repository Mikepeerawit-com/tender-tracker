import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { maxImagesAtOnce } from "@/lib/images/images";
import { blankQuote } from "@/lib/quotes/quote-form";
import messages from "@/messages/en.json";

import { QuoteForm } from "./quote-form";

/**
 * One supplier call, one pass through the screen — the half that only exists once the
 * form is interactive.
 *
 * A picked file goes nowhere until the price is saved, which is not a claim any server
 * test can make: the holding happens in the browser, and the only way to see that
 * Storage was left alone is to pick a photo and watch nothing be signed. What the
 * *ordering* means is asserted over fixtures in `@/lib/quotes/quote-with-photos`; this is
 * about the screen honouring it — and about the two endings that reach a person, the
 * refusal that keeps the photos and the partial run that keeps the Quote.
 *
 * Three boundaries are stubbed and nothing else: the two actions, and Storage itself. The
 * compressor is deliberately left real — `createImageBitmap` does not exist here, so it
 * takes its own documented fallback and hands the original file back, which is exactly
 * what it does on a webview that cannot decode a HEIC.
 */

type Signed = { ok: true; uploads: { storagePath: string; token: string }[] };

const server = {
  /** Every call that reached a boundary, in the order it did. The ordering assertion. */
  log: [] as string[],
  /** What the next create-a-Quote submit does. */
  create: vi.fn(),
  sign: vi.fn(),
  record: vi.fn(),
  /** Files whose upload to Storage drops, by name. */
  dropped: new Set<string>(),
  /** What actually reached the bucket. */
  uploaded: [] as { storagePath: string; name: string }[],
};

vi.mock("@/app/actions/quotes", () => ({
  createQuoteAction: (previous: unknown, formData: FormData) => {
    server.log.push("create");

    return server.create(previous, formData);
  },
}));

vi.mock("@/app/actions/quote-photos", () => ({
  signQuotePhotoUploadsAction: (input: { quoteId: string; images: unknown[] }) => {
    server.log.push(`sign ${input.quoteId}`);

    return server.sign(input);
  },
  recordQuotePhotosAction: (input: { quoteId: string; storagePaths: string[] }) => {
    server.log.push(`record ${input.quoteId}`);

    return server.record(input);
  },
}));

vi.mock("@/lib/supabase/storage-client", () => ({
  createStorageClient: () => ({
    storage: {
      from: () => ({
        uploadToSignedUrl: async (storagePath: string, _token: string, file: File) => {
          if (server.dropped.has(file.name)) return { error: new Error("no signal") };

          server.uploaded.push({ storagePath, name: file.name });

          return { error: null };
        },
      }),
    },
  }),
}));

function aPhoto(name: string): File {
  return new File([new Uint8Array([0xff, 0xd8])], name, { type: "image/jpeg" });
}

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Bangkok">
      <QuoteForm
        tenderId="a-tender"
        tenderItemId="an-item"
        defaults={blankQuote({ unit: "box of 50", today: "2026-08-21" })}
      />
    </NextIntlClientProvider>,
  );
}

/** Fill in enough of the price for a submit to be a realistic one. */
async function typeAQuote(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/supplier/i), "Ace Medical");
  await user.type(screen.getByLabelText(/price per unit/i), "118");
}

const choosePhotos = () => screen.getByLabelText("Choose photos");
const save = () => screen.getByRole("button", { name: "Save quote" });

/** One signed key per picture, in the order they were handed over. */
function signsEverything(quoteId: string) {
  return (input: { images: unknown[] }): Signed => ({
    ok: true,
    uploads: input.images.map((_image, index) => ({
      storagePath: `an-org/quotes/${quoteId}/${index}.jpg`,
      token: "a-token",
    })),
  });
}

beforeEach(() => {
  server.log = [];
  server.uploaded = [];
  server.dropped = new Set();
  server.create.mockReset();
  server.sign.mockReset().mockImplementation(signsEverything("quote-written"));
  server.record.mockReset().mockResolvedValue({});
});

describe("photos picked while the Quote is being entered", () => {
  it("holds them in the browser rather than uploading as they are picked", async () => {
    // The whole premise. A photo signed at pick time would need a Quote to be signed
    // against, and there is not one yet — which is how the two-pass flow came about.
    const user = userEvent.setup();

    renderForm();
    await user.upload(choosePhotos(), aPhoto("ace-gloves.jpg"));

    expect(screen.queryByText("ace-gloves.jpg")).not.toBeNull();
    expect(server.log).toEqual([]);
  });

  it("writes the Quote before it signs a single photo", async () => {
    // The ordering, as the screen performs it. A storage key minted before the row exists
    // is an object in a folder nothing answers to: invisible to every screen, and billed.
    const user = userEvent.setup();

    server.create.mockResolvedValue({ quoteId: "quote-written" });

    renderForm();
    await typeAQuote(user);
    await user.upload(choosePhotos(), aPhoto("ace-gloves.jpg"));
    await user.click(save());

    await waitFor(() =>
      expect(server.log).toEqual([
        "create",
        "sign quote-written",
        "record quote-written",
      ]),
    );
    expect(server.uploaded).toEqual([
      { storagePath: "an-org/quotes/quote-written/0.jpg", name: "ace-gloves.jpg" },
    ]);
  });

  it("never uploads one that was picked and then taken off again", async () => {
    const user = userEvent.setup();

    server.create.mockResolvedValue({ quoteId: "quote-written" });

    renderForm();
    await typeAQuote(user);
    await user.upload(choosePhotos(), [aPhoto("keep-me.jpg"), aPhoto("wrong-box.jpg")]);
    await user.click(screen.getByRole("button", { name: "Remove wrong-box.jpg" }));

    expect(screen.queryByText("wrong-box.jpg")).toBeNull();

    await user.click(save());

    await waitFor(() => expect(server.uploaded).toHaveLength(1));
    expect(server.uploaded[0].name).toBe("keep-me.jpg");
    // Not merely un-uploaded: never signed either, so no key was ever minted for it.
    expect(server.sign).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ images: [expect.anything()] }),
    );
  });

  it("refuses a batch past the cap at the picker, while it is still fixable", async () => {
    // Said here rather than by the uploader, which would only reach it once the Quote was
    // written and the eleven photos were stranded against it — offering a retry of eleven
    // photos that is refused for being eleven photos, forever.
    const user = userEvent.setup();

    renderForm();
    await user.upload(
      choosePhotos(),
      Array.from({ length: maxImagesAtOnce + 1 }, (_unused, index) =>
        aPhoto(`photo-${index}.jpg`),
      ),
    );

    expect(screen.getByRole("alert").textContent).toMatch(/too many pictures at once/i);
    // Refused rather than truncated: a picker that silently kept ten of eleven is one
    // that loses a photograph without saying so.
    expect(screen.queryByText("photo-0.jpg")).toBeNull();
  });

  it("keeps them through a refusal, and attaches them to the corrected resubmit", async () => {
    // A refusal empties an uncontrolled form unless it is re-seeded, and the same trap
    // applies to the files: losing them would mean re-taking photographs of a box that
    // has by now gone back on the shelf.
    const user = userEvent.setup();

    server.create.mockResolvedValueOnce({
      error: "invalid_price",
      submitted: { ...blankQuote({ unit: "box of 50", today: "2026-08-21" }),
        supplierName: "Ace Medical" },
    });

    renderForm();
    await typeAQuote(user);
    await user.upload(choosePhotos(), aPhoto("ace-gloves.jpg"));
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /give a price greater than zero/i,
      ),
    );
    expect(screen.queryByText("ace-gloves.jpg")).not.toBeNull();
    expect(server.log).toEqual(["create"]);

    // Corrected and sent again. The photo that was held through the refusal goes up now.
    server.create.mockResolvedValue({ quoteId: "quote-written" });
    await user.click(save());

    await waitFor(() => expect(server.uploaded).toHaveLength(1));
    expect(server.uploaded[0].name).toBe("ace-gloves.jpg");
  });
});

describe("when the Quote saves and a photo does not", () => {
  it("keeps the Quote, names what did not make it, and offers those again", async () => {
    // The recoverable ending. The price is the part that cannot be got twice — the
    // supplier has rung off — so this must not read as a failed Quote.
    const user = userEvent.setup();

    server.create.mockResolvedValue({ quoteId: "quote-written" });
    server.dropped = new Set(["second.jpg"]);

    renderForm();
    await typeAQuote(user);
    await user.upload(choosePhotos(), [aPhoto("first.jpg"), aPhoto("second.jpg")]);
    await user.click(save());

    await waitFor(() =>
      expect(
        screen.queryByText(
          /the quote from ace medical is saved\. these photos did not upload: second\.jpg/i,
        ),
      ).not.toBeNull(),
    );

    // The one that did land was still recorded: a dropped signal after the first photo
    // keeps the first.
    expect(server.record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ storagePaths: ["an-org/quotes/quote-written/0.jpg"] }),
    );
    // And the Quote is reported as saved, not as refused. `images.error.failed` and
    // `quotes.error.failed` are the same sentence, so "no refusal is on screen" is asserted
    // by what a success does and a refusal does not: the form goes back to blank, rather
    // than being re-seeded with the price that was just typed into it.
    expect(screen.queryByText("Quote saved.")).not.toBeNull();
    expect(screen.getByLabelText(/supplier/i)).toHaveProperty("value", "");

    // Retrying aims at the Quote that exists rather than writing a second one, and
    // carries only the photo that is still outstanding.
    server.dropped = new Set();
    server.log = [];
    await user.click(screen.getByRole("button", { name: "Try those photos again" }));

    await waitFor(() =>
      expect(server.log).toEqual(["sign quote-written", "record quote-written"]),
    );
    expect(server.create).toHaveBeenCalledOnce();
    expect(server.uploaded.at(-1)).toEqual({
      storagePath: "an-org/quotes/quote-written/0.jpg",
      name: "second.jpg",
    });
    // Nothing outstanding left to offer.
    expect(screen.queryByRole("button", { name: "Try those photos again" })).toBeNull();
  });

  it("does not take the offer away when the next supplier's Quote saves cleanly", async () => {
    // An Assignee rings four suppliers in a row on this screen, which is what the form is
    // built for. A photograph taken through a `capture` input is not necessarily in the
    // camera roll afterwards, so the held file may be the only copy there is — and losing
    // it silently, to an unrelated submit that went fine, is losing the photograph.
    const user = userEvent.setup();

    server.create.mockResolvedValueOnce({ quoteId: "quote-ace" });
    server.dropped = new Set(["ace-gloves.jpg"]);

    renderForm();
    await typeAQuote(user);
    await user.upload(choosePhotos(), aPhoto("ace-gloves.jpg"));
    await user.click(save());

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Try those photos again" }),
      ).not.toBeNull(),
    );

    // A second supplier, no photographs, nothing wrong with it.
    server.create.mockResolvedValueOnce({ quoteId: "quote-siam" });
    await user.type(screen.getByLabelText(/supplier/i), "Siam Surgical");
    await user.type(screen.getByLabelText(/price per unit/i), "131");
    await user.click(save());

    await waitFor(() => expect(server.create).toHaveBeenCalledTimes(2));

    // Ace Medical's photo is still outstanding, still named, still offered.
    expect(
      screen.queryByText(/the quote from ace medical is saved/i),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Try those photos again" }),
    ).not.toBeNull();
  });
});

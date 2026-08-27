"use client";

import { useRef } from "react";
import { Camera, Images } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { photoAccept } from "@/lib/images/images";

/**
 * The two ways a supplier's photo gets onto this app, side by side.
 *
 * ## Two inputs, and the second one is required
 *
 * The camera input carries `accept="image/*" capture`, because on a phone the gesture
 * here is *take one now* — the supplier is on the line or has just rung off. But
 * **`capture` is a hint, not a guarantee** (buildspec_2.md A4): the WeCom webview was
 * measured opening the camera straight away on an iPhone, Android was never measured at
 * all, and the research on Android WebView is bad enough that a camera hint is the
 * sharper risk of the two. So the library picker sits beside it, visible, always, rather
 * than as something to find when the first button does nothing.
 *
 * The picker is also the honest control for the common desktop case, where a supplier
 * emailed a photograph and somebody is entering the Quote at a desk.
 *
 * ## Why it is a component and not markup in two places
 *
 * Both entry points need it — the create-a-Quote form, where photos are picked before
 * the price is saved, and the row of a Quote already recorded, where photos that arrived
 * later by email are added afterwards. Both are permanent (#60), and the rule that
 * neither control may become the only one, or hide behind the other, has to hold on both.
 * Two copies would be two places for one of them to quietly lose its fallback, and the
 * copy that lost it would be the one somebody on an Android phone was holding.
 *
 * A fragment rather than a box of its own, because each caller already has a row to lay
 * these out in and a second wrapper inside it would change how that row wraps — the two
 * buttons would break to a new line together rather than each finding its own place,
 * which is a change to the Quote row nobody asked for.
 */
export function QuotePhotoPicker({
  onPicked,
  disabled = false,
}: {
  /**
   * What was chosen. Never called empty — a picker dismissed without a choice says
   * nothing. Awaited, so an uploader keeps its inputs cleared only once it has finished
   * with the files; one that merely holds them can return whatever it likes.
   */
  onPicked: (files: File[]) => unknown;
  disabled?: boolean;
}) {
  const t = useTranslations("quotes.photos");
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  async function picked(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];

    if (files.length === 0) return;

    try {
      await onPicked(files);
    } finally {
      // Cleared however it ended: the input keeps its old FileList otherwise, so
      // re-taking the same photo fires no `change` event and the retry looks like a hang.
      input.value = "";
    }
  }

  return (
    <>
      {/* Both inputs are off-screen and driven by their buttons, because a bare file
          input cannot be given a label a thumb can find. Neither is *hidden* in the
          sense that matters: both buttons are visible, side by side, always. */}
      <input
        ref={camera}
        type="file"
        accept={photoAccept}
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label={t("take")}
        onChange={(event) => void picked(event.currentTarget)}
      />
      <input
        ref={library}
        type="file"
        multiple
        accept={photoAccept}
        className="sr-only"
        tabIndex={-1}
        aria-label={t("choose")}
        onChange={(event) => void picked(event.currentTarget)}
      />

      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={disabled}
        onClick={() => camera.current?.click()}
      >
        <Camera className="size-4" aria-hidden />
        {t("take")}
      </Button>

      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={disabled}
        onClick={() => library.current?.click()}
      >
        <Images className="size-4" aria-hidden />
        {t("choose")}
      </Button>
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { switchTheme } from "@/app/actions/theme";
import { Button } from "@/components/ui/button";
import { themeChoices, type ThemeChoice } from "@/lib/theme/config";

/**
 * System, light or dark — the three answers, all three on screen at once.
 *
 * **The shape is {@link LocaleSwitcher}'s**, and deliberately: the two controls sit in the
 * same card stack on Preferences, they are the only two things on it, and a pair that
 * behaved differently would make the screen read as two features rather than one screen.
 * So: a 44px target on every option, the current one filled and the others outlined, a
 * spinner on the option that was pressed, and the sentence said `sr-only` where it costs
 * no pixels.
 *
 * **System is an option rather than the absence of one.** A control that offered light and
 * dark alone would leave a reader who wants to follow their phone with nothing to press,
 * and — worse — no way back once they had pressed either (ADR-0024).
 *
 * `current` is handed in rather than read here, because what the control must agree with
 * is *what the page is painted in*, which is the cookie the root layout resolved this
 * request from. The user row is what remembers the choice across devices; the cookie is
 * what the reader is looking at.
 *
 * Which option spins is state of its own rather than something derived from `isPending`,
 * which says only that *a* transition is running and not which theme it is for — the same
 * note the language switcher carries.
 */
export function ThemeSwitcher({ current }: { current: ThemeChoice }) {
  const t = useTranslations("themeSwitcher");
  const [isPending, startTransition] = useTransition();
  const [switchingTo, setSwitchingTo] = useState<ThemeChoice | null>(null);

  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-2">
      {themeChoices.map((choice) => (
        <Button
          key={choice}
          type="button"
          className="h-11 px-4"
          variant={choice === current ? "default" : "outline"}
          aria-current={choice === current}
          disabled={isPending}
          onClick={() => {
            setSwitchingTo(choice);
            startTransition(() => switchTheme(choice));
          }}
        >
          {t(choice)}
          {isPending && switchingTo === choice ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : null}
        </Button>
      ))}
      {/* Mounted always, with the sentence appearing inside it, for the reason the
          language switcher states: a live region inserted at the same moment it gains its
          text is one several screen readers never announce. */}
      <span role="status" className="sr-only">
        {isPending ? t("switching") : ""}
      </span>
    </nav>
  );
}

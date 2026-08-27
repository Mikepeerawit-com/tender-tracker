"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { switchLocale } from "@/app/actions/locale";
import { locales, type Locale } from "@/i18n/config";
import { Button } from "@/components/ui/button";

/**
 * `prominent` is for the signed-out screens. Everywhere else this is a secondary
 * control tucked into a header, but on the login page it is the only way past a form
 * you cannot read — so there it gets the same 44px tap target as the form itself. The
 * default 28px is fine for a mouse and too small for a thumb.
 *
 * `compact` names each language by its own short form — `EN`, `中文` — instead of in
 * full. It is what the app bar uses, where two full language names cost more width than
 * the row has (#56). **Both languages stay on screen either way**, which is the part that
 * must not be traded for space: a reader who cannot read the language they are looking at
 * needs to see the other one, not find it behind a menu.
 *
 * **The spinner, and why it is not a word.** Switching used to set nothing but
 * `disabled`: the two buttons greyed out and that was the whole signal, which the #48
 * hand-check read exactly as it looks — *"the change are also slow"*, with nothing saying
 * work was under way (#57). So the button that was pressed grows a spinner. It is an icon
 * rather than a "Switching…" label because that label is on the app bar, and #56 was the
 * bill for a bar that ran out of width; the sentence is still said, `sr-only`, where it
 * costs no pixels and is the half a screen reader needs. `locale-switcher.layout.test.tsx`
 * measures the spun state at 390px, since a control only wide enough before it is pressed
 * is one nobody measured.
 *
 * Which button spins is state of its own rather than something derived from `isPending`,
 * which says only that *a* transition is running and not which language it is for.
 */
export function LocaleSwitcher({
  prominent = false,
  compact = false,
}: {
  prominent?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("localeSwitcher");
  const current = useLocale();
  const [isPending, startTransition] = useTransition();
  const [switchingTo, setSwitchingTo] = useState<Locale | null>(null);

  return (
    <nav aria-label={t("label")} className="flex gap-2">
      {locales.map((locale) => (
        <Button
          key={locale}
          type="button"
          size={prominent ? "default" : "sm"}
          className={prominent ? "h-11 px-4" : compact ? "h-11 px-2.5" : undefined}
          variant={locale === current ? "default" : "outline"}
          aria-current={locale === current}
          disabled={isPending}
          onClick={() => {
            setSwitchingTo(locale);
            startTransition(() => switchLocale(locale));
          }}
        >
          {compact ? t(`short.${locale}`) : t(locale)}
          {isPending && switchingTo === locale ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : null}
        </Button>
      ))}
      {/* Mounted always, with the sentence appearing inside it, rather than mounted when
          there is something to say. A live region inserted at the same moment it gains
          its text is one several screen readers never announce, because they have nothing
          to compare it against — which would make this the silent half of a control whose
          whole point is that it stopped being silent. */}
      <span role="status" className="sr-only">
        {isPending ? t("switching") : ""}
      </span>
    </nav>
  );
}

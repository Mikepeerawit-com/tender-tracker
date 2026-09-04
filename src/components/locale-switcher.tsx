"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { switchLocale } from "@/app/actions/locale";
import { locales, type Locale } from "@/i18n/config";
import { Button } from "@/components/ui/button";

/**
 * The way out of a language you cannot read: both of them, named in their own script.
 *
 * **One shape, since #132.** It had two — a full-size pair for the signed-out screens and
 * a `compact` pair naming each language `EN` / `中文` for the app bar, which #56 had run
 * out of width on. The switcher has left the bar: behind the login it lives on the
 * Preferences screen, which is a settings screen with a column to itself, and both places
 * it is now drawn are places a thumb has to hit it. So both get the 44px target and both
 * get the language's full name, and the shortened pair went with the prop.
 *
 * **Both languages stay on screen**, which is the part that must not be traded for space:
 * a reader who cannot read the language they are looking at needs to see the other one,
 * not find it behind a menu. That is the whole argument for the switcher being on the
 * signed-out screens at all — somebody who cannot read the login form cannot get past it
 * — and it is why it is still there, as prominent as it ever was, after leaving the bar.
 *
 * **The spinner, and why it is not a word.** Switching used to set nothing but
 * `disabled`: the two buttons greyed out and that was the whole signal, which the #48
 * hand-check read exactly as it looks — *"the change are also slow"*, with nothing saying
 * work was under way (#57). So the button that was pressed grows a spinner, and the
 * sentence is said `sr-only`, where it costs no pixels and is the half a screen reader
 * needs. `locale-switcher.layout.test.tsx` measures the spun state at 390px, since a
 * control only wide enough before it is pressed is one nobody measured.
 *
 * Which button spins is state of its own rather than something derived from `isPending`,
 * which says only that *a* transition is running and not which language it is for.
 */
export function LocaleSwitcher() {
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
          className="h-11 px-4"
          variant={locale === current ? "default" : "outline"}
          aria-current={locale === current}
          disabled={isPending}
          onClick={() => {
            setSwitchingTo(locale);
            startTransition(() => switchLocale(locale));
          }}
        >
          {t(locale)}
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

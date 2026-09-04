import { useTranslations } from "next-intl";

import { chooseLanguageAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { locales } from "@/i18n/config";

/**
 * The two answers `/choose-language` offers, one form each.
 *
 * **A component rather than markup inside the page**, for the reason `ScreenHeader` and
 * `TenderRow` are components: the page is an `async` Server Component that reads the
 * session and redirects, so no browser test can reach it, and a screen with no sync seam
 * cannot be measured at all. This was markup in the page until #135, and the fixture that
 * stood in for it in `@/test/screens` was a hand-copy — which is a guard watching a
 * replica, green on the day the real page is repainted.
 *
 * Both options are drawn **in their own language**, not in the one currently rendering:
 * whoever is reading this has not chosen yet and cannot be assumed to read either
 * (ADR-0011). That is why the labels come from a message with no translation of its own —
 * `option.en` is "English" in both files — rather than from the locale's own vocabulary.
 *
 * A form each rather than one form with two submit values: the action takes the locale,
 * and two forms say so in the markup instead of in a handler.
 */
export function ChooseLanguageOptions() {
  const t = useTranslations("chooseLanguage");

  return (
    <div className="flex flex-col gap-3">
      {locales.map((locale) => (
        <form key={locale} action={chooseLanguageAction}>
          <input type="hidden" name="locale" value={locale} />
          <Button
            type="submit"
            variant="outline"
            className="h-11 w-full justify-start text-base"
          >
            {t(`option.${locale}`)}
          </Button>
        </form>
      ))}
    </div>
  );
}

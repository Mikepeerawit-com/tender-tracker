import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { chooseLanguageAction } from "@/app/actions/auth";
import { AuthScreen } from "@/components/auth/auth-screen";
import { Button } from "@/components/ui/button";
import { locales } from "@/i18n/config";
import { currentUser } from "@/lib/auth/session";

/**
 * First start-up asks which language, rather than inferring one.
 *
 * `Accept-Language` would be a guess dressed as a setting: a colleague working from
 * China and one in Bangkok would silently get different apps, and the one who got the
 * wrong guess has no reason to think there is a switch. Both locales are complete at
 * launch, so there is a real choice to offer.
 *
 * Presented in both languages at once — whoever is reading this cannot yet be assumed
 * to read either one.
 */
export default async function ChooseLanguagePage() {
  const user = await currentUser(await cookies());

  if (!user) redirect("/login");
  if (user.locale) redirect("/");

  const t = await getTranslations("chooseLanguage");

  return (
    <AuthScreen title={t("title")}>
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
    </AuthScreen>
  );
}

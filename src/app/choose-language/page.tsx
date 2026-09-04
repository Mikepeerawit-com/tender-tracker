import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthScreen } from "@/components/auth/auth-screen";
import { ChooseLanguageOptions } from "@/components/auth/choose-language-options";
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
      <ChooseLanguageOptions />
    </AuthScreen>
  );
}

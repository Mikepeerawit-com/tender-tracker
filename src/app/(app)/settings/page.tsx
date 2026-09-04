import { getTranslations } from "next-intl/server";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Measure } from "@/components/ui/screen-body";
import { ScreenHeader } from "@/components/ui/screen-header";
import { getThemeChoice } from "@/lib/theme/cookie";

/**
 * **Preferences** — what this app is set up as for one member, and for nobody else.
 *
 * It is `/settings` itself rather than `/settings/preferences`, and that is the whole of
 * the redirect this ticket would otherwise have needed: the group every member has is the
 * one Settings should open on, so the destination and its landing screen are one address.
 * A member who administers nothing types or taps `Settings` and arrives somewhere with
 * something on it.
 *
 * **The language switcher lives here now** (#132). It was on the app bar, where the
 * argument for it was that a reader who cannot read the language they are looking at needs
 * to see the other one rather than find it behind a menu. That argument is untouched on
 * the *signed-out* screens, where it still sits in `AuthScreen` exactly as prominently as
 * before — but behind the login a member has already chosen a locale on first start-up, so
 * it does not carry here, and the bar is one control lighter in both scripts (#56).
 *
 * **The theme sits beside it** (#133), which is the second thing on the screen and the
 * reason Preferences is a stack of cards rather than one. Both are the same kind of fact —
 * what this app is set up as for one member, remembered on their own row and seen by
 * nobody else — and neither belongs anywhere near the Organisation group, where a change
 * lands on colleagues' screens.
 *
 * There is no gate on this screen and there should not be: everything on it is the
 * reader's own.
 */
export default async function PreferencesPage() {
  const t = await getTranslations("preferences");
  const language = await getTranslations("localeSwitcher");
  const appearance = await getTranslations("themeSwitcher");

  // What the page is *painted* in, which is the cookie the root layout resolved this
  // request from rather than the row behind it. See the note on `ThemeSwitcher`.
  const theme = await getThemeChoice();

  return (
    <>
      <ScreenHeader heading={t("title")}>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </ScreenHeader>

      <Measure>
        <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
          <h2 className="text-sm font-medium">{language("label")}</h2>
          <LocaleSwitcher />
        </section>

        <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
          <h2 className="text-sm font-medium">{appearance("label")}</h2>
          <ThemeSwitcher current={theme} />
        </section>
      </Measure>
    </>
  );
}

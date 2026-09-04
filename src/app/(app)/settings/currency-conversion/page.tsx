import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CurrencyConversionForm } from "@/components/admin/currency-conversion-form";
import { Measure } from "@/components/ui/screen-body";
import { ScreenHeader } from "@/components/ui/screen-header";
import { currentUser } from "@/lib/auth/session";
import { asPercent } from "@/lib/org/fx-buffer";
import { getOrgSettings } from "@/lib/org/org";

/**
 * Where the org says how much is added to the market exchange rate when a supplier's
 * foreign price is turned into Baht — the FX Buffer, which until this screen could only
 * be changed with SQL against production. The third screen in Settings' **Organisation**
 * group.
 *
 * Hidden from non-admins with `notFound()` rather than a redirect, for the reason the
 * other two do it: a page that says "you are not allowed here" also says that here
 * exists. The real gate is in the server action, because that is the public endpoint.
 *
 * The setting is read through `getOrgSettings`, which is the same read every Quote's
 * `freezeRate` goes through — so what this screen shows and what the next Quote freezes
 * cannot come from two different places.
 */
export default async function CurrencyConversionPage() {
  const store = await cookies();
  const user = await currentUser(store);

  if (!user?.isOrgAdmin) notFound();

  const t = await getTranslations("currencyConversion");
  const { fxBufferPct } = await getOrgSettings(store);

  return (
    <>
      <ScreenHeader heading={t("title")}>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </ScreenHeader>

      <Measure>
        <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
          <CurrencyConversionForm percent={asPercent(fxBufferPct)} />
        </section>
      </Measure>

      {/* The promise the setting makes to history, said out loud on the screen that can
          break it — including the one exception, because an Org Admin who met it as a
          surprise would have been told something false here. ADR-0018: correcting the day
          a Quote claims re-freezes that Quote against the new date. */}
      <Measure>
        <p className="text-muted-foreground text-sm">{t("affects")}</p>
      </Measure>
    </>
  );
}

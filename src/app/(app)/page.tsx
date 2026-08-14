import { getTranslations } from "next-intl/server";

import { LocaleSwitcher } from "@/components/locale-switcher";

export default async function Home() {
  const t = await getTranslations();

  return (
    <div className="bg-background flex flex-1 flex-col items-center justify-center p-6">
      <main className="flex w-full max-w-xl flex-col gap-6">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("placeholder.heading")}
        </h1>
        <p className="text-muted-foreground">{t("placeholder.body")}</p>
        <LocaleSwitcher />
        <a
          className="text-sm underline underline-offset-4"
          href="/api/health"
          rel="noreferrer"
        >
          {t("placeholder.healthLabel")}
        </a>
      </main>
    </div>
  );
}

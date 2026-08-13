"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import { switchLocale } from "@/app/actions/locale";
import { locales } from "@/i18n/config";
import { Button } from "@/components/ui/button";

export function LocaleSwitcher() {
  const t = useTranslations("localeSwitcher");
  const current = useLocale();
  const [isPending, startTransition] = useTransition();

  return (
    <nav aria-label={t("label")} className="flex gap-2">
      {locales.map((locale) => (
        <Button
          key={locale}
          type="button"
          size="sm"
          variant={locale === current ? "default" : "outline"}
          aria-current={locale === current}
          disabled={isPending}
          onClick={() => startTransition(() => switchLocale(locale))}
        >
          {t(locale)}
        </Button>
      ))}
    </nav>
  );
}

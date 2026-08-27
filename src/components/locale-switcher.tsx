"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import { switchLocale } from "@/app/actions/locale";
import { locales } from "@/i18n/config";
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
          onClick={() => startTransition(() => switchLocale(locale))}
        >
          {compact ? t(`short.${locale}`) : t(locale)}
        </Button>
      ))}
    </nav>
  );
}

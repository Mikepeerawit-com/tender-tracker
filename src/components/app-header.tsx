import Link from "next/link";
import { useTranslations } from "next-intl";

import { AppMenu } from "@/components/app-menu";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";

/**
 * The bar across the top of everything behind the login.
 *
 * Rendered on the server, which is why it is sync rather than `async`: `useTranslations`
 * works in a Server Component, and keeping it synchronous is what lets
 * `app-header.layout.test.tsx` measure it in a real browser at 390px. The layout it sits
 * in is `async` — it gates on `currentUser` — and so is unreachable from a browser test;
 * this is the seam that is not.
 *
 * It takes the two facts it draws rather than the whole user, because those two are all
 * that change what is on the bar: the name, and whether the admin pair appears.
 *
 * It sits loose in `components/` rather than in `ui/` or a domain folder, beside the
 * `LocaleSwitcher` it renders: `ui/` is for the domain-free primitives, a domain folder
 * is for components that know about Tenders, and this is app chrome that knows about
 * neither — it knows about the nav and the session.
 *
 * **One row, at every width.** #56 found six buttons here on a 390px phone with nothing
 * able to wrap — `Button` is `shrink-0 whitespace-nowrap`, so not one of them gives up a
 * pixel — and the bar pushed every screen sideways. Letting it wrap fixed the overflow
 * and cost three rows on a phone, which is most of a small screen spent on navigation.
 * So the bar does not wrap: what stays on it is the tender list and the language, and
 * everything rarer is behind {@link AppMenu}.
 *
 * The name is the one part that can be any width, because a member is enrolled under
 * whatever name they gave. `min-w-0` with `truncate` lets it give up space to the
 * controls either side of it rather than push them off the row — it is the only thing
 * here that may be shortened, since a clipped name is still recognisable and half a
 * button is not.
 */
export function AppHeader({
  name,
  isOrgAdmin,
}: {
  name: string;
  isOrgAdmin: boolean;
}) {
  const t = useTranslations("nav");

  return (
    <header className="border-border flex items-center justify-between gap-2 border-b px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {/* This link is on every screen in the app, so its prefetch fires most often and
            is discarded most often — see the note in `tender-row.tsx`. */}
        <Button
          variant="ghost"
          size="sm"
          className="h-11"
          nativeButton={false}
          render={<Link href="/tenders" prefetch={false} />}
        >
          {t("tenders")}
        </Button>
        <span className="text-muted-foreground min-w-0 truncate text-sm">{name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <LocaleSwitcher compact />
        <AppMenu isOrgAdmin={isOrgAdmin} />
      </div>
    </header>
  );
}

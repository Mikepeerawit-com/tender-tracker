import Link from "next/link";

import { signOutAction } from "@/app/actions/auth";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

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
 * **Why the bar wraps.** An org admin's is six buttons wide — Tenders, People, Group
 * Robot, the two locales and Sign out — and `Button` is `shrink-0 whitespace-nowrap`, so
 * not one of them gives up a pixel. On a 390px phone that is far more than the row has,
 * and because this bar is on every screen it pushed *every* screen sideways: hand-check 1
 * of #48 reported the tender list, a Tender and the comparison sheet all too wide, which
 * is one cause on the thing all three share rather than three faults (#56). Wrapping is
 * the fix rather than shrinking, because the buttons are tap targets and the 44px floor
 * is not negotiable for them.
 *
 * **The `flex-wrap` that does the work is the right-hand group's**, and it is worth being
 * exact about that, because three other things here look like the fix and are not. Taking
 * `flex-wrap` off that group alone fails `app-header.layout.test.tsx`; taking it off the
 * outer bar, or `min-w-0` off the left group or off the name, currently fails nothing —
 * the right group's wrap already keeps the bar inside the viewport. Those three are kept
 * as defence for inputs the fixtures do not have, chiefly a member enrolled under a very
 * long name with no space in it, but nothing measures them today. If one of them ever
 * looks redundant enough to delete, that is the honest reason it can be.
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
    <header className="border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/tenders" />}>
          {t("tenders")}
        </Button>
        <span className="text-muted-foreground min-w-0 text-sm break-words">{name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isOrgAdmin ? (
          <>
            <Button variant="ghost" size="sm" nativeButton={false} render={<a href="/admin/people" />}>
              {t("people")}
            </Button>
            <Button variant="ghost" size="sm" nativeButton={false} render={<a href="/admin/group-robot" />}>
              {t("groupRobot")}
            </Button>
          </>
        ) : null}
        <LocaleSwitcher />
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" size="sm">
            {t("signOut")}
          </Button>
        </form>
      </div>
    </header>
  );
}

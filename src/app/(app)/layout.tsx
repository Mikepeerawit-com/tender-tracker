import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { signOutAction } from "@/app/actions/auth";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/auth/session";

/**
 * Everything behind the login.
 *
 * The gate is here rather than only in `proxy.ts` because the proxy checks that a
 * session exists, and that is a weaker question than the one that matters: a disabled
 * member still holds a valid session until it expires, but reads nothing through RLS —
 * so `currentUser` returns null for them and they land back at the login on their very
 * next request.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser(await cookies());

  if (!user) redirect("/login");
  if (!user.locale) redirect("/choose-language");

  const t = await getTranslations("nav");

  return (
    <>
      <header className="border-border flex items-center justify-between gap-4 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/tenders" />}>
            {t("tenders")}
          </Button>
          <span className="text-muted-foreground text-sm">{user.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {user.isOrgAdmin ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<a href="/admin/people" />}>
              {t("people")}
            </Button>
          ) : null}
          <LocaleSwitcher />
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm">
              {t("signOut")}
            </Button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}

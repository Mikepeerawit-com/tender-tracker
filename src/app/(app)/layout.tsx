import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
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

  return (
    <>
      <AppHeader name={user.name} isOrgAdmin={user.isOrgAdmin} />
      {children}
    </>
  );
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BottomNav } from "@/components/app-nav";
import { currentUser } from "@/lib/auth/session";

/**
 * Everything behind the login.
 *
 * The gate is here rather than only in `proxy.ts` because the proxy checks that a
 * session exists, and that is a weaker question than the one that matters: a disabled
 * member still holds a valid session until it expires, but reads nothing through RLS —
 * so `currentUser` returns null for them and they land back at the login on their very
 * next request.
 *
 * **The app bar is not drawn here any more.** Since #73 it states *where the reader is*,
 * and a layout cannot see the params of the page beneath it — so a bar rendered here
 * could never name which Tender this is. Each page draws its own; `currentUser` is
 * wrapped in React `cache()`, so the gate below is what the pages' calls are answered
 * from and none of them costs a round trip.
 *
 * **The bottom bar is drawn here, and it is the one piece of navigation that can be.** It
 * says where a reader may *go*, which is the same answer on every screen — unlike the app
 * bar, which says where they *are*. Putting it here is what makes both destinations
 * reachable from every screen behind the login including the two that replace a page,
 * `loading.tsx` and `error.tsx`: a fallback that took the way out with it would strand
 * somebody on a screen that could not load. Above `md` it is absent and the same two
 * destinations sit on the app bar instead (ADR-0021).
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser(await cookies());

  if (!user) redirect("/login");
  if (!user.locale) redirect("/choose-language");

  return (
    <>
      {children}
      <BottomNav />
    </>
  );
}

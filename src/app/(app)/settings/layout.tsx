import { cookies } from "next/headers";

import { Screen } from "@/components/screen";
import { SettingsFrame } from "@/components/settings/settings-nav";
import { currentUser } from "@/lib/auth/session";

/**
 * **Settings: one destination, one frame, four screens** (#132).
 *
 * The frame is drawn here rather than by each page, which is the one place in this app
 * where that is right. #73 moved the app bar onto the page because the bar says *where the
 * reader is* and a layout cannot see the params of the page beneath it — but every screen
 * under Settings is about no record at all, so all four draw the same wordmark bar, and
 * the sub-navigation column beside them is the same on all four too. What is left for a
 * page is its own heading and its own form.
 *
 * **`measure="42rem"` for all of them**, because each of the four is a short form and
 * nothing else — which is the case ADR-0022 gives for the tighter of its two measures.
 * The sub-navigation is outside it and spans the region, as that ADR says navigation does.
 *
 * **Who is looking is asked here, once.** The bar stopped asking it in #132 and the three
 * Organisation screens each still refuse a non-admin themselves with `notFound()`, so this
 * read decides one thing only: whether the Organisation group is drawn in the column.
 * `currentUser` is wrapped in React `cache()` and `(app)/layout.tsx` has already gated on
 * the answer, so asking again costs no round trip.
 */
export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const user = await currentUser(await cookies());

  return (
    <Screen measure="42rem">
      <SettingsFrame isOrgAdmin={user?.isOrgAdmin ?? false}>{children}</SettingsFrame>
    </Screen>
  );
}

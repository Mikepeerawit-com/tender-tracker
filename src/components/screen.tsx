import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppHeader, type AppLocation } from "@/components/app-header";
import {
  ScreenBody,
  type MeasureWidth,
  type ScreenGap,
} from "@/components/ui/screen-body";
import { currentUser } from "@/lib/auth/session";

/**
 * The frame every screen behind the login sits in — the app bar, then the body's wrapper.
 *
 * The signed-in counterpart of `AuthScreen`. #73 moved the bar off the `(app)` layout and
 * onto the page, because the bar says *where the reader is* and a layout cannot see the
 * params of the page beneath it. That was right, and it left eight pages opening with the
 * same two lines of wrapper markup; this is that wrapper, written once.
 *
 * **`location` still comes from the page**, and deliberately: it is the whole of what #73
 * bought. A shell that guessed the shape from the route would put the knowledge back in
 * the layout, where the Tender's reference and client name cannot be reached.
 *
 * **`isOrgAdmin` does not.** It was passed at all eight call sites: the same question,
 * about the same session, asked eight times. `currentUser` is wrapped in React `cache()`,
 * so asking it here costs nothing — `(app)/layout.tsx` has already gated on the answer
 * and this is served from the request rather than the network. The `?? false` is the
 * type being satisfied rather than a case that arises: nothing renders a `Screen` without
 * having passed that gate, and the admin menu is all it would decide.
 *
 * **Nothing about the width reaches the bar any more, because there is nothing to say**
 * (ADR-0022, #131). Every screen behind the login draws in one region, so `AppHeader` and
 * `ScreenBody` both write it themselves and a page has no way to hand them different
 * answers. What a page may still vary is `measure` — how wide a line of its prose and its
 * fields are — and that is the body's alone: the bar carries no prose and no fields.
 *
 * The two screens that stand in for a page — `(app)/loading.tsx` and `(app)/error.tsx` —
 * do not use this. They draw their own `AppHeader` in the wordmark shape, because at that
 * moment nobody knows which record is coming, and their bodies compose {@link ScreenBody}
 * directly. Their reasoning is written down in those files; do not undo it.
 */
export async function Screen({
  location,
  measure,
  gap,
  children,
}: {
  /** The shape the bar draws. Omitted on the screens that are not about one record. */
  location?: AppLocation;
  /** How wide this screen's prose and fields are allowed to be. Its default is the app's. */
  measure?: MeasureWidth;
  gap?: ScreenGap;
  children: ReactNode;
}) {
  const user = await currentUser(await cookies());

  return (
    <>
      <AppHeader isOrgAdmin={user?.isOrgAdmin ?? false} location={location} />
      <ScreenBody measure={measure} gap={gap}>
        {children}
      </ScreenBody>
    </>
  );
}

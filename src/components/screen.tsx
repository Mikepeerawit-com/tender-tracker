import type { ReactNode } from "react";

import { AppHeader, type AppLocation } from "@/components/app-header";
import {
  ScreenBody,
  type MeasureWidth,
  type ScreenGap,
} from "@/components/ui/screen-body";

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
 * **Nothing about the reader reaches the bar any more either** (#132). It took an
 * `isOrgAdmin` — asked here of `currentUser` so that eight call sites did not each have to
 * — because the app menu drew three extra rows for an Org Admin. Those three are one
 * `Settings` row now, which every member has, so the bar is the same markup for everybody
 * and this composes it with no session read at all. Who may see the Organisation group is
 * asked once, in `(app)/settings/layout.tsx`, on the screen it decides.
 *
 * **Nothing about the width reaches the bar either, because there is nothing to say**
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
export function Screen({
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
  return (
    <>
      <AppHeader location={location} />
      <ScreenBody measure={measure} gap={gap}>
        {children}
      </ScreenBody>
    </>
  );
}

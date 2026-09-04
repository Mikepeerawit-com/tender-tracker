import { AppHeader } from "@/components/app-header";
import { ScreenSkeleton } from "@/components/ui/screen-skeleton";

/**
 * The Suspense boundary for everything behind the login.
 *
 * One file at the top of `(app)` covers every screen under it: `loading.tsx` wraps the
 * segment's `page.tsx` *and* every nested layout and page below, and every one of those
 * screens opens with a `ScreenHeader` over a column of blocks, which is exactly what
 * `ScreenSkeleton` draws. Since ADR-0022 they are all drawn in the same region as this
 * one, so nothing widens when the page lands; the note in `screen-skeleton.tsx` says what
 * is left of that, which is the measure and nothing else.
 *
 * It sits here rather than at the app root on purpose. The `(app)` layout gates on
 * `currentUser`, and a fallback above that gate would paint the signed-in shape at
 * somebody on their way to the login.
 *
 * Note that this does not stream the *layout* — `(app)/layout.tsx` reads `cookies()`, and
 * the Next docs are explicit that a fallback is not shown for runtime data read in a
 * layout.
 *
 * **It draws the bar itself**, because since #73 the bar states where the reader is and
 * so belongs to the page rather than the layout — and a page being replaced by this
 * fallback takes its bar with it. The wordmark shape is the honest one to draw here: at
 * this moment nobody knows yet which record is coming — and since #132 the bar asks
 * nothing about the reader either, so this draws the same one every other screen does.
 */
export default function Loading() {
  return (
    <>
      <AppHeader />
      <ScreenSkeleton />
    </>
  );
}

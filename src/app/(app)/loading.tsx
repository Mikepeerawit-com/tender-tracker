import { ScreenSkeleton } from "@/components/ui/screen-skeleton";

/**
 * The Suspense boundary for everything behind the login.
 *
 * One file at the top of `(app)` covers every screen under it: `loading.tsx` wraps the
 * segment's `page.tsx` *and* every nested layout and page below, and none of those
 * screens wants a different fallback — they all open with a `ScreenHeader` over a column
 * of blocks, which is exactly what `ScreenSkeleton` draws.
 *
 * It sits here rather than at the app root on purpose. The `(app)` layout gates on
 * `currentUser`, and a fallback above that gate would paint the signed-in shape at
 * somebody on their way to the login.
 *
 * Note that this does not stream the *layout* — `(app)/layout.tsx` reads `cookies()`, and
 * the Next docs are explicit that a fallback is not shown for runtime data read in a
 * layout. That costs nothing here: the layout only renders once, and every navigation
 * after it is a page swap underneath an app bar that is already on screen.
 */
export default function Loading() {
  return <ScreenSkeleton />;
}

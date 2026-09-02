import { useTranslations } from "next-intl";

import { ScreenBody } from "@/components/ui/screen-body";
import { ScreenHeader } from "@/components/ui/screen-header";

/**
 * What a screen behind the login looks like while it is still being fetched.
 *
 * There was no `loading.tsx` anywhere in the app, and without one a route segment has no
 * Suspense boundary — so nothing streamed and the browser held the *previous* screen
 * until every query for the next one had resolved (#57). Inside the WeCom webview on
 * mobile data that is indistinguishable from a tap that did nothing, which is what the
 * #48 hand-check reported: *"maybe something should show when there's a loading state, so
 * the user can know that the web is still working"*.
 *
 * It draws a `ScreenHeader` rather than a shape of its own. Every screen in `(app)` opens
 * with one, so borrowing it is what keeps the fallback and the screen it stands in for
 * from disagreeing about where the page starts — and it is the seam that makes this
 * measurable at 390×844 (`screen-skeleton.layout.test.tsx`), since a fallback is a screen
 * a phone user really sees and ADR-0009's bar applies to it like any other.
 *
 * **The bars in the header carry fixed widths, not fractions.** `ScreenHeader`'s text
 * column is a shrink-to-fit flex item, so its width comes from its content — and a
 * percentage width asks for a share of a number that is being derived from it. One such
 * bar among fixed-width siblings resolves fine, against the width those siblings set; a
 * header whose bars are *all* fractions has nothing to resolve against and collapses to
 * an empty column, which is measured in `screen-skeleton.layout.test.tsx`. Below the
 * header the bars sit in blocks whose width is already settled, and there `w-full` is
 * safe.
 *
 * The app bar is deliberately absent *from here*, but not from the fallback. Since #73 the
 * bar states where the reader is, so it belongs to the page rather than the layout — and a
 * page being replaced by this takes its bar with it. `(app)/loading.tsx` draws one itself
 * above this, which is where the reasoning for the shape it draws lives.
 *
 * That is also why this composes {@link ScreenBody} rather than `Screen`: `Screen` draws
 * the bar, and a fallback that used it would put a second one under `loading.tsx`'s. The
 * wrapper below it is the same wrapper every page gets, at its default width — which is
 * what keeps this and the bar above it agreeing about where the page starts.
 *
 * **On the Owner's two screens it is narrower than what replaces it**, and that is the
 * accepted cost of one fallback for eight screens. Since #97 the tender list and the
 * Tender detail are composed at the desk's 1280 while this stays at the phone's 768, so a
 * monitor sees a narrow skeleton widen when the page lands. It cannot be fixed here:
 * `loading.tsx` is one file above every route under `(app)` and cannot see which page is
 * coming — the same fact that makes it draw the wordmark rather than a record — and a
 * per-route fallback is four files to hold in step for a few hundred milliseconds of grey
 * boxes. Widening *this* instead would put the jump on the six screens that are narrow,
 * which is the same fault more often.
 */
export function ScreenSkeleton() {
  const t = useTranslations("app");

  return (
    <ScreenBody>
      {/* The only thing here with anything to say. Everything below is shape. */}
      <p role="status" className="sr-only">
        {t("loading")}
      </p>

      <div aria-hidden className="contents">
        <ScreenHeader
          heading={<Bar className="h-7 w-48" />}
          actions={<Bar className="h-11 w-24" />}
        >
          <Bar className="h-4 w-40" />
          <Bar className="h-4 w-32" />
        </ScreenHeader>

        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="border-border flex flex-col gap-3 rounded-lg border p-4"
            >
              <Bar className="h-4 w-full" />
              <Bar className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </ScreenBody>
  );
}

/**
 * One grey bar standing in for a line of text.
 *
 * `motion-reduce:animate-none` because this is a whole screen of things pulsing at once,
 * which is the case the preference exists for.
 */
function Bar({ className }: { className: string }) {
  return (
    <span
      className={`bg-muted block animate-pulse rounded motion-reduce:animate-none ${className}`}
    />
  );
}
